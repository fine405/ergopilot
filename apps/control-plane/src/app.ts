import { approvalRequestSchema, taskSpecSchema } from "@ergopilot/contracts";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";

import type { StationClient } from "./station-client";
import { StationRpcError } from "./station-client";

export interface AppOptions {
  now?: () => number;
  allowedOrigin?: string;
}

export function createApp(station: StationClient, options: AppOptions = {}) {
  const now = options.now ?? Date.now;
  const allowedOrigin = options.allowedOrigin ?? "http://localhost:3000";
  const app = new Hono()
    .use("/api/*", cors({ origin: allowedOrigin }))
    .use(
      "/api/*",
      bodyLimit({
        maxSize: 64 * 1024,
        onError: (context) =>
          context.json(
            {
              error: {
                code: "payload_too_large",
                message: "request body exceeds 64 KiB",
              },
            },
            413,
          ),
      }),
    )
    .get("/api/health", (context) =>
      context.json({ status: "ok", stationAdapter: "process" as const }),
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
