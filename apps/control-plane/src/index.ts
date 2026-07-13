import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";

import { createApp } from "./app";
import { openFilePlannerAttemptStore } from "./planner-attempt-store";
import { createProcessStationClient } from "./station-client";
import { createConfiguredTaskPlanners } from "./task-planner";

try {
  loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const hostname = "127.0.0.1";
const allowedOrigin = process.env.ERGOPILOT_WEB_ORIGIN;
const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const plannerAttemptStore = await openFilePlannerAttemptStore(
  resolve(
    workspaceRoot,
    process.env.ERGOPILOT_PLANNER_ATTEMPTS_PATH ??
      "target/ergopilot-planner-attempts.json",
  ),
);
const app = createApp(createProcessStationClient(), {
  ...(allowedOrigin ? { allowedOrigin } : {}),
  plannerAttemptStore,
  planners: createConfiguredTaskPlanners(),
});
const server = serve({ fetch: app.fetch, hostname, port });

console.log(`ErgoPilot control plane listening on http://${hostname}:${port}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
