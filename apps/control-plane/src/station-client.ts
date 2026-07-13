import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type TaskRunView,
  type TaskSpec,
  taskRunViewSchema,
  type WorkstationSnapshot,
  workstationSnapshotSchema,
} from "@ergopilot/contracts";
import { z } from "zod";

export interface StationClient {
  startTask(task: TaskSpec, nowMs: number): Promise<TaskRunView>;
  inspectTask(runId: string): Promise<TaskRunView>;
  approveTask(
    runId: string,
    approvedBy: string,
    nowMs: number,
  ): Promise<TaskRunView>;
  cancelTask(
    runId: string,
    cancelledBy: string,
    nowMs: number,
  ): Promise<TaskRunView>;
  demoApproveTaskWithAckLoss(
    runId: string,
    approvedBy: string,
    nowMs: number,
  ): Promise<TaskRunView>;
  demoApproveTaskWithDeviceOffline(
    runId: string,
    approvedBy: string,
    nowMs: number,
  ): Promise<TaskRunView>;
  demoApproveTaskWithActuatorJam(
    runId: string,
    approvedBy: string,
    nowMs: number,
  ): Promise<TaskRunView>;
  demoApproveTaskWithDeviceUnavailableBeforeDispatch(
    runId: string,
    approvedBy: string,
    nowMs: number,
  ): Promise<TaskRunView>;
  resumeTask(runId: string, nowMs: number): Promise<TaskRunView>;
  reconcileTask(runId: string, nowMs: number): Promise<TaskRunView>;
  stationSnapshot(observedAtMs: number): Promise<WorkstationSnapshot>;
}

type RpcRequest =
  | { method: "task.start"; params: { task: TaskSpec; nowMs: number } }
  | { method: "task.inspect"; params: { runId: string } }
  | {
      method: "task.approve";
      params: { runId: string; approvedBy: string; nowMs: number };
    }
  | {
      method: "task.cancel";
      params: { runId: string; cancelledBy: string; nowMs: number };
    }
  | {
      method: "demo.task.approve_with_ack_loss";
      params: { runId: string; approvedBy: string; nowMs: number };
    }
  | {
      method: "demo.task.approve_with_device_offline";
      params: { runId: string; approvedBy: string; nowMs: number };
    }
  | {
      method: "demo.task.approve_with_actuator_jam";
      params: { runId: string; approvedBy: string; nowMs: number };
    }
  | {
      method: "demo.task.approve_with_device_unavailable_before_dispatch";
      params: { runId: string; approvedBy: string; nowMs: number };
    }
  | { method: "task.resume"; params: { runId: string; nowMs: number } }
  | { method: "task.reconcile"; params: { runId: string; nowMs: number } }
  | { method: "station.snapshot"; params: { observedAtMs: number } };

const stationRpcErrorCodeSchema = z.enum([
  "invalid_request",
  "forbidden",
  "run_not_found",
  "task_conflict",
  "invalid_transition",
  "approval_expired",
  "recovery_budget_exhausted",
  "device_unavailable",
  "actuator_fault",
  "station_rpc_error",
  "output_limit",
  "timeout",
  "spawn_failed",
  "unexpected_exit",
  "invalid_response",
]);

export type StationRpcErrorCode = z.infer<typeof stationRpcErrorCodeSchema>;

const rpcEnvelopeSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: stationRpcErrorCodeSchema,
      message: z.string(),
    }),
  }),
]);

export class StationRpcError extends Error {
  constructor(
    readonly code: StationRpcErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StationRpcError";
  }
}

export interface ProcessStationClientOptions {
  binaryPath: string;
  databasePath: string;
  policyKey: string;
  motionStepMs?: number;
  timeoutMs?: number;
}

export class ProcessStationClient implements StationClient {
  readonly #options: Required<ProcessStationClientOptions>;

  constructor(options: ProcessStationClientOptions) {
    const motionStepMs = options.motionStepMs ?? 0;
    const timeoutMs = options.timeoutMs ?? 5_000;
    if (
      !Number.isSafeInteger(motionStepMs) ||
      motionStepMs < 0 ||
      motionStepMs > 400
    ) {
      throw new Error("motionStepMs must be between 0 and 400");
    }
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= motionStepMs * 10 + 500
    ) {
      throw new Error(
        "timeoutMs must exceed the simulated motion duration by 500 ms",
      );
    }
    this.#options = { ...options, motionStepMs, timeoutMs };
  }

  startTask(task: TaskSpec, nowMs: number): Promise<TaskRunView> {
    return this.#invoke(
      { method: "task.start", params: { task, nowMs } },
      taskRunViewSchema,
    );
  }

  inspectTask(runId: string): Promise<TaskRunView> {
    return this.#invoke(
      { method: "task.inspect", params: { runId } },
      taskRunViewSchema,
    );
  }

  approveTask(
    runId: string,
    approvedBy: string,
    nowMs: number,
  ): Promise<TaskRunView> {
    return this.#invoke(
      { method: "task.approve", params: { runId, approvedBy, nowMs } },
      taskRunViewSchema,
    );
  }

  cancelTask(
    runId: string,
    cancelledBy: string,
    nowMs: number,
  ): Promise<TaskRunView> {
    return this.#invoke(
      { method: "task.cancel", params: { runId, cancelledBy, nowMs } },
      taskRunViewSchema,
    );
  }

  demoApproveTaskWithAckLoss(
    runId: string,
    approvedBy: string,
    nowMs: number,
  ): Promise<TaskRunView> {
    return this.#invoke(
      {
        method: "demo.task.approve_with_ack_loss",
        params: { runId, approvedBy, nowMs },
      },
      taskRunViewSchema,
    );
  }

  demoApproveTaskWithDeviceOffline(
    runId: string,
    approvedBy: string,
    nowMs: number,
  ): Promise<TaskRunView> {
    return this.#invoke(
      {
        method: "demo.task.approve_with_device_offline",
        params: { runId, approvedBy, nowMs },
      },
      taskRunViewSchema,
    );
  }

  demoApproveTaskWithActuatorJam(
    runId: string,
    approvedBy: string,
    nowMs: number,
  ): Promise<TaskRunView> {
    return this.#invoke(
      {
        method: "demo.task.approve_with_actuator_jam",
        params: { runId, approvedBy, nowMs },
      },
      taskRunViewSchema,
    );
  }

  demoApproveTaskWithDeviceUnavailableBeforeDispatch(
    runId: string,
    approvedBy: string,
    nowMs: number,
  ): Promise<TaskRunView> {
    return this.#invoke(
      {
        method: "demo.task.approve_with_device_unavailable_before_dispatch",
        params: { runId, approvedBy, nowMs },
      },
      taskRunViewSchema,
    );
  }

  reconcileTask(runId: string, nowMs: number): Promise<TaskRunView> {
    return this.#invoke(
      { method: "task.reconcile", params: { runId, nowMs } },
      taskRunViewSchema,
    );
  }

  resumeTask(runId: string, nowMs: number): Promise<TaskRunView> {
    return this.#invoke(
      { method: "task.resume", params: { runId, nowMs } },
      taskRunViewSchema,
    );
  }

  stationSnapshot(observedAtMs: number): Promise<WorkstationSnapshot> {
    return this.#invoke(
      { method: "station.snapshot", params: { observedAtMs } },
      workstationSnapshotSchema,
    );
  }

  #invoke<T>(request: RpcRequest, resultSchema: z.ZodType<T>): Promise<T> {
    const { binaryPath, databasePath, motionStepMs, policyKey, timeoutMs } =
      this.#options;
    return new Promise((resolve, reject) => {
      const child = spawn(binaryPath, ["--rpc", databasePath], {
        env: {
          ...process.env,
          ERGOPILOT_POLICY_KEY: policyKey,
          ERGOPILOT_SIM_MOTION_STEP_MS: String(motionStepMs),
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        callback();
      };
      const append = (target: Buffer[], chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > 1_048_576) {
          child.kill("SIGKILL");
          finish(() =>
            reject(
              new StationRpcError(
                "output_limit",
                "station RPC output exceeded 1 MiB",
              ),
            ),
          );
          return;
        }
        target.push(chunk);
      };
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        finish(() =>
          reject(
            new StationRpcError(
              "timeout",
              `station RPC did not finish within ${timeoutMs} ms`,
            ),
          ),
        );
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => append(stdout, chunk));
      child.stderr.on("data", (chunk: Buffer) => append(stderr, chunk));
      child.on("error", (error) => {
        finish(() =>
          reject(new StationRpcError("spawn_failed", error.message)),
        );
      });
      child.on("close", (exitCode) => {
        finish(() => {
          try {
            const rawOutput = Buffer.concat(stdout).toString("utf8");
            const envelope = rpcEnvelopeSchema.parse(JSON.parse(rawOutput));
            if (!envelope.ok) {
              reject(
                new StationRpcError(
                  envelope.error.code,
                  envelope.error.message,
                ),
              );
              return;
            }
            if (exitCode !== 0) {
              reject(
                new StationRpcError(
                  "unexpected_exit",
                  Buffer.concat(stderr).toString("utf8") ||
                    `station RPC exited with code ${exitCode}`,
                ),
              );
              return;
            }
            resolve(resultSchema.parse(envelope.result));
          } catch (error) {
            reject(
              new StationRpcError(
                "invalid_response",
                error instanceof Error ? error.message : String(error),
              ),
            );
          }
        });
      });
      child.stdin.end(JSON.stringify(request));
    });
  }
}

export function createProcessStationClient(
  environment: NodeJS.ProcessEnv = process.env,
): ProcessStationClient {
  const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const policyKey = environment.ERGOPILOT_POLICY_KEY;
  if (!policyKey && environment.NODE_ENV === "production") {
    throw new Error("ERGOPILOT_POLICY_KEY is required in production");
  }
  return new ProcessStationClient({
    binaryPath: resolve(
      workspaceRoot,
      environment.ERGOPILOT_STATION_BIN ?? "target/debug/station-cli",
    ),
    databasePath: resolve(
      workspaceRoot,
      environment.ERGOPILOT_DATABASE_PATH ??
        "target/ergopilot-control-plane.sqlite",
    ),
    policyKey: policyKey ?? "ergopilot-local-development-key",
    motionStepMs: parseMotionStepMs(
      environment.ERGOPILOT_SIM_MOTION_STEP_MS ?? "100",
    ),
  });
}

function parseMotionStepMs(value: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 400) {
    throw new Error("ERGOPILOT_SIM_MOTION_STEP_MS must be between 0 and 400");
  }
  return parsed;
}
