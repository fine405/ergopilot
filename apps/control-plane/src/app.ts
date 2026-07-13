import { randomUUID } from "node:crypto";
import {
  approvalRequestSchema,
  type PlannerAttempt,
  plannerAttemptSchema,
  plannerAttemptsResponseSchema,
  plannerProviderIdSchema,
  type TaskPlanRequest,
  taskPlanRequestSchema,
  taskSpecSchema,
} from "@ergopilot/contracts";
import { type Hook, zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";

import type { StationClient } from "./station-client";
import { StationRpcError } from "./station-client";
import {
  describePlannerProviders,
  PLANNER_PROVIDERS,
  PlannerError,
  type TaskPlannerRegistry,
} from "./task-planner";

export interface AppOptions {
  now?: () => number;
  allowedOrigin?: string;
  planners?: TaskPlannerRegistry;
}

type AppEnvironment = {
  Variables: {
    plannerAttemptRecorded: boolean;
    plannerStartedAtMs: number;
    plannerTraceId: string;
  };
};

type EmptyHookResponse = Record<never, never>;

export function createApp(station: StationClient, options: AppOptions = {}) {
  const now = options.now ?? Date.now;
  const allowedOrigin = options.allowedOrigin ?? "http://localhost:3000";
  const plannerAttempts: PlannerAttempt[] = [];
  const recordPlannerAttempt = (
    context: Context<AppEnvironment>,
    attempt: unknown,
  ) => {
    plannerAttempts.unshift(plannerAttemptSchema.parse(attempt));
    plannerAttempts.splice(100);
    context.set("plannerAttemptRecorded", true);
  };
  const recordUnattributedPlannerFailure = (
    context: Context<AppEnvironment>,
    errorCode: "invalid_request" | "payload_too_large",
  ) => {
    const startedAtMs = context.get("plannerStartedAtMs");
    recordPlannerAttempt(context, {
      traceId: context.get("plannerTraceId"),
      provider: null,
      model: null,
      startedAtMs,
      durationMs: Math.max(0, now() - startedAtMs),
      outcome: "failed",
      taskId: null,
      errorCode,
    });
  };
  const recordInvalidPlannerRequest: Hook<
    TaskPlanRequest,
    AppEnvironment,
    string,
    "json",
    EmptyHookResponse,
    typeof taskPlanRequestSchema
  > = (result, context) => {
    if (result.success) return;
    const providerCandidate =
      typeof result.data === "object" && result.data !== null
        ? Reflect.get(result.data, "provider")
        : undefined;
    const parsedProvider = plannerProviderIdSchema.safeParse(providerCandidate);
    const provider = parsedProvider.success ? parsedProvider.data : null;
    const startedAtMs = context.get("plannerStartedAtMs");
    recordPlannerAttempt(context, {
      traceId: context.get("plannerTraceId"),
      provider,
      model: provider === null ? null : PLANNER_PROVIDERS[provider].model,
      startedAtMs,
      durationMs: Math.max(0, now() - startedAtMs),
      outcome: "failed",
      taskId: null,
      errorCode: "invalid_request",
    });
    return context.json(
      {
        error: {
          code: "invalid_request",
          message: "request body does not match TaskPlanRequest",
        },
      },
      400,
    );
  };
  const app = new Hono<AppEnvironment>()
    .use(
      "/api/*",
      cors({
        origin: allowedOrigin,
        exposeHeaders: ["X-ErgoPilot-Trace-Id"],
      }),
    )
    .use("/api/task-plans", async (context, next) => {
      const traceId = `plan-${randomUUID()}`;
      context.set("plannerAttemptRecorded", false);
      context.set("plannerTraceId", traceId);
      context.set("plannerStartedAtMs", now());
      context.header("X-ErgoPilot-Trace-Id", traceId);
      await next();
    })
    .use(
      "/api/*",
      bodyLimit({
        maxSize: 64 * 1024,
        onError: (context) => {
          if (context.req.path === "/api/task-plans") {
            recordUnattributedPlannerFailure(context, "payload_too_large");
          }
          return context.json(
            {
              error: {
                code: "payload_too_large",
                message: "request body exceeds 64 KiB",
              },
            },
            413,
          );
        },
      }),
    )
    .get("/api/health", (context) =>
      context.json({ status: "ok", stationAdapter: "process" as const }),
    )
    .get("/api/planner-providers", (context) =>
      context.json(describePlannerProviders(options.planners ?? {})),
    )
    .get("/api/planner-attempts", (context) =>
      context.json(
        plannerAttemptsResponseSchema.parse({ attempts: plannerAttempts }),
      ),
    )
    .post(
      "/api/task-plans",
      zValidator<
        typeof taskPlanRequestSchema,
        "json",
        AppEnvironment,
        string,
        typeof recordInvalidPlannerRequest
      >("json", taskPlanRequestSchema, recordInvalidPlannerRequest),
      async (context) => {
        const request = context.req.valid("json");
        const traceId = context.get("plannerTraceId");
        const startedAtMs = context.get("plannerStartedAtMs");
        const recordAttempt = (
          outcome: PlannerAttempt["outcome"],
          taskId: string | null,
          errorCode: PlannerAttempt["errorCode"],
        ) => {
          recordPlannerAttempt(context, {
            traceId,
            provider: request.provider,
            model: PLANNER_PROVIDERS[request.provider].model,
            startedAtMs,
            durationMs: Math.max(0, now() - startedAtMs),
            outcome,
            taskId,
            errorCode,
          });
        };
        const planner = options.planners?.[request.provider];
        if (!planner) {
          recordAttempt("failed", null, "provider_unavailable");
          return context.json(
            {
              error: {
                code: "provider_unavailable",
                message: `${request.provider} planner provider is not configured`,
              },
            },
            503,
          );
        }
        try {
          const plan = await planner.plan(request);
          recordAttempt("succeeded", plan.task.taskId, null);
          return context.json(plan);
        } catch (error) {
          recordAttempt(
            "failed",
            null,
            error instanceof PlannerError ? error.code : "internal_error",
          );
          throw error;
        }
      },
    )
    .post(
      "/api/task-runs",
      zValidator("json", taskSpecSchema),
      async (context) => {
        const run = await station.startTask(context.req.valid("json"), now());
        return context.json(run, 201);
      },
    )
    .get("/api/task-runs/:runId", async (context) =>
      context.json(await station.inspectTask(context.req.param("runId"))),
    )
    .post(
      "/api/task-runs/:runId/approve",
      zValidator("json", approvalRequestSchema),
      async (context) => {
        const { approvedBy } = context.req.valid("json");
        const run = await station.approveTask(
          context.req.param("runId"),
          approvedBy,
          now(),
        );
        return context.json(run);
      },
    )
    .post("/api/task-runs/:runId/reconcile", async (context) =>
      context.json(
        await station.reconcileTask(context.req.param("runId"), now()),
      ),
    )
    .get("/api/station/snapshot", async (context) =>
      context.json(await station.stationSnapshot(now())),
    );

  app.notFound((context) =>
    context.json(
      { error: { code: "not_found", message: "route not found" } },
      404,
    ),
  );
  app.onError((error, context) => {
    if (
      error instanceof HTTPException &&
      error.status === 400 &&
      context.req.path === "/api/task-plans" &&
      !context.get("plannerAttemptRecorded")
    ) {
      recordUnattributedPlannerFailure(context, "invalid_request");
      return context.json(
        {
          error: {
            code: "invalid_request",
            message: "request body does not match TaskPlanRequest",
          },
        },
        400,
      );
    }
    if (error instanceof PlannerError) {
      return context.json(
        { error: { code: error.code, message: error.message } },
        502,
      );
    }
    if (error instanceof StationRpcError) {
      return context.json(
        { error: { code: error.code, message: error.message } },
        502,
      );
    }
    return context.json(
      { error: { code: "internal_error", message: error.message } },
      500,
    );
  });
  return app;
}

export type AppType = ReturnType<typeof createApp>;
