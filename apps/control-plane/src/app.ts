import { randomUUID } from "node:crypto";
import {
  approvalRequestSchema,
  cancellationRequestSchema,
  type PlannerAttempt,
  plannerAttemptSchema,
  plannerAttemptsResponseSchema,
  plannerEvaluationsResponseSchema,
  plannerProviderIdSchema,
  runtimeObservationSchema,
  saveWorkstationProfileRequestSchema,
  type TaskPlanRequest,
  type TaskPlanResponse,
  taskPlanRequestSchema,
  taskSpecSchema,
  workstationCapabilityCatalog,
} from "@ergopilot/contracts";
import { type Hook, zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";

import {
  createMemoryPlannerAttemptStore,
  type PlannerAttemptStore,
  PlannerAttemptStoreError,
} from "./planner-attempt-store";
import {
  type PlannerEvaluationStore,
  PlannerEvaluationStoreError,
} from "./planner-evaluation-store";
import {
  type StationClient,
  StationRpcError,
  type StationRpcErrorCode,
} from "./station-client";
import {
  describePlannerProviders,
  PLANNER_PROVIDERS,
  PlannerError,
  type TaskPlannerRegistry,
} from "./task-planner";

export interface AppOptions {
  now?: () => number;
  allowedOrigin?: string;
  operatorId?: string;
  plannerAttemptStore?: PlannerAttemptStore;
  plannerEvaluationStore?: PlannerEvaluationStore;
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

function stationRpcStatus(
  code: StationRpcErrorCode,
): 400 | 403 | 404 | 409 | 502 | 503 | 504 {
  switch (code) {
    case "invalid_request":
      return 400;
    case "forbidden":
      return 403;
    case "run_not_found":
      return 404;
    case "task_conflict":
    case "invalid_transition":
    case "approval_expired":
    case "recovery_budget_exhausted":
    case "actuator_fault":
      return 409;
    case "device_unavailable":
      return 503;
    case "timeout":
      return 504;
    case "station_rpc_error":
    case "output_limit":
    case "spawn_failed":
    case "unexpected_exit":
    case "invalid_response":
      return 502;
  }
}

export function createApp(station: StationClient, options: AppOptions = {}) {
  const now = options.now ?? Date.now;
  const operatorId = options.operatorId?.trim() || "local-operator";
  if (operatorId.length > 128) {
    throw new Error("operatorId must not exceed 128 characters");
  }
  const allowedOrigins = [
    options.allowedOrigin ?? "http://localhost:3000",
    "tauri://localhost",
    "http://tauri.localhost",
  ];
  const plannerAttemptStore =
    options.plannerAttemptStore ?? createMemoryPlannerAttemptStore();
  const plannerEvaluationStore = options.plannerEvaluationStore ?? {
    list: async () => [],
  };
  const recordPlannerAttempt = async (
    context: Context<AppEnvironment>,
    attempt: unknown,
  ) => {
    try {
      await plannerAttemptStore.record(plannerAttemptSchema.parse(attempt));
    } catch (error) {
      throw error instanceof PlannerAttemptStoreError
        ? error
        : new PlannerAttemptStoreError(
            "planner attempt store could not be written",
            { cause: error },
          );
    }
    context.set("plannerAttemptRecorded", true);
  };
  const recordUnattributedPlannerFailure = async (
    context: Context<AppEnvironment>,
    errorCode: "invalid_request" | "payload_too_large",
  ) => {
    const startedAtMs = context.get("plannerStartedAtMs");
    await recordPlannerAttempt(context, {
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
  > = async (result, context) => {
    if (result.success) return;
    const providerCandidate =
      typeof result.data === "object" && result.data !== null
        ? Reflect.get(result.data, "provider")
        : undefined;
    const parsedProvider = plannerProviderIdSchema.safeParse(providerCandidate);
    const provider = parsedProvider.success ? parsedProvider.data : null;
    const startedAtMs = context.get("plannerStartedAtMs");
    await recordPlannerAttempt(context, {
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
        origin: allowedOrigins,
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
        onError: async (context) => {
          if (context.req.path === "/api/task-plans") {
            await recordUnattributedPlannerFailure(
              context,
              "payload_too_large",
            );
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
    .get("/api/capabilities", (context) =>
      context.json(workstationCapabilityCatalog),
    )
    .get("/api/planner-providers", (context) =>
      context.json(describePlannerProviders(options.planners ?? {})),
    )
    .get("/api/planner-attempts", (context) =>
      context.json(
        plannerAttemptsResponseSchema.parse({
          attempts: plannerAttemptStore.list(),
        }),
      ),
    )
    .get("/api/planner-evaluations", async (context) =>
      context.json(
        plannerEvaluationsResponseSchema.parse({
          reports: await plannerEvaluationStore.list(),
        }),
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
        const recordAttempt = async (
          outcome: PlannerAttempt["outcome"],
          taskId: string | null,
          errorCode: PlannerAttempt["errorCode"],
        ) => {
          await recordPlannerAttempt(context, {
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
          await recordAttempt("failed", null, "provider_unavailable");
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
        let plan: TaskPlanResponse;
        try {
          plan = await planner.plan(request);
        } catch (error) {
          await recordAttempt(
            "failed",
            null,
            error instanceof PlannerError ? error.code : "internal_error",
          );
          throw error;
        }
        await recordAttempt("succeeded", plan.task.taskId, null);
        return context.json(plan);
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
    .get("/api/task-runs/:runId/stream", async (context) => {
      const runId = context.req.param("runId");
      return streamSSE(context, async (stream) => {
        for (let sample = 0; sample < 80 && !stream.aborted; sample += 1) {
          const [run, stationSnapshot] = await Promise.all([
            station.inspectTask(runId),
            station.stationSnapshot(now()),
          ]);
          const latestProgress = run.deskMotionProgress.at(-1);
          const observation = runtimeObservationSchema.parse({
            run,
            station:
              (run.status === "executing" || run.status === "suspended") &&
              latestProgress
                ? {
                    ...stationSnapshot,
                    deskHeightMm: latestProgress.deskHeightMm,
                  }
                : stationSnapshot,
          });
          await stream.writeSSE({
            event: "observation",
            id: `${run.events.at(-1)?.sequence ?? 0}-${latestProgress?.sequence ?? 0}-${observation.station.stateVersion}-${observation.station.deskHeightMm}`,
            data: JSON.stringify(observation),
          });

          if (
            [
              "completed",
              "failed",
              "cancelled",
              "denied",
              "outcome_unknown",
            ].includes(run.status)
          ) {
            break;
          }
          await stream.sleep(100);
        }
      });
    })
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
    .post(
      "/api/task-runs/:runId/cancel",
      zValidator("json", cancellationRequestSchema),
      async (context) => {
        const { cancelledBy } = context.req.valid("json");
        return context.json(
          await station.cancelTask(
            context.req.param("runId"),
            cancelledBy,
            now(),
          ),
        );
      },
    )
    .post(
      "/api/demo/task-runs/:runId/approve-with-ack-loss",
      zValidator("json", approvalRequestSchema),
      async (context) => {
        const { approvedBy } = context.req.valid("json");
        const run = await station.demoApproveTaskWithAckLoss(
          context.req.param("runId"),
          approvedBy,
          now(),
        );
        return context.json(run);
      },
    )
    .post(
      "/api/demo/task-runs/:runId/approve-with-device-offline",
      zValidator("json", approvalRequestSchema),
      async (context) => {
        const { approvedBy } = context.req.valid("json");
        const run = await station.demoApproveTaskWithDeviceOffline(
          context.req.param("runId"),
          approvedBy,
          now(),
        );
        return context.json(run);
      },
    )
    .post(
      "/api/demo/task-runs/:runId/approve-with-actuator-jam",
      zValidator("json", approvalRequestSchema),
      async (context) => {
        const { approvedBy } = context.req.valid("json");
        const run = await station.demoApproveTaskWithActuatorJam(
          context.req.param("runId"),
          approvedBy,
          now(),
        );
        return context.json(run);
      },
    )
    .post(
      "/api/demo/task-runs/:runId/approve-with-device-unavailable-before-dispatch",
      zValidator("json", approvalRequestSchema),
      async (context) => {
        const { approvedBy } = context.req.valid("json");
        const run =
          await station.demoApproveTaskWithDeviceUnavailableBeforeDispatch(
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
    .post("/api/task-runs/:runId/resume", async (context) =>
      context.json(
        await station.resumeTask(context.req.param("runId"), operatorId, now()),
      ),
    )
    .get("/api/profiles", async (context) =>
      context.json(await station.listProfiles()),
    )
    .post(
      "/api/profiles",
      zValidator("json", saveWorkstationProfileRequestSchema),
      async (context) =>
        context.json(
          await station.saveProfile(context.req.valid("json"), now()),
          201,
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
  app.onError(async (error, context) => {
    if (
      error instanceof HTTPException &&
      error.status === 400 &&
      context.req.path === "/api/task-plans" &&
      !context.get("plannerAttemptRecorded")
    ) {
      await recordUnattributedPlannerFailure(context, "invalid_request");
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
    if (error instanceof PlannerAttemptStoreError) {
      return context.json(
        {
          error: {
            code: "trace_persistence_failed",
            message: "planner attempt evidence could not be persisted",
          },
        },
        503,
      );
    }
    if (error instanceof PlannerEvaluationStoreError) {
      return context.json(
        {
          error: {
            code: "evaluation_evidence_unavailable",
            message: error.message,
          },
        },
        503,
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
        stationRpcStatus(error.code),
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
