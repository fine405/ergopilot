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
  | { method: "task.reconcile"; params: { runId: string; nowMs: number } }
  | { method: "station.snapshot"; params: { observedAtMs: number } };

const rpcEnvelopeSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);

export class StationRpcError extends Error {
  constructor(
    readonly code: string,
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
  timeoutMs?: number;
}

export class ProcessStationClient implements StationClient {
  readonly #options: Required<ProcessStationClientOptions>;

  constructor(options: ProcessStationClientOptions) {
    this.#options = { timeoutMs: 5_000, ...options };
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

  reconcileTask(runId: string, nowMs: number): Promise<TaskRunView> {
    return this.#invoke(
      { method: "task.reconcile", params: { runId, nowMs } },
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
    const { binaryPath, databasePath, policyKey, timeoutMs } = this.#options;
    return new Promise((resolve, reject) => {
      const child = spawn(binaryPath, ["--rpc", databasePath], {
        env: { ...process.env, ERGOPILOT_POLICY_KEY: policyKey },
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
  });
}
