import {
  type PlannerAttemptsResponse,
  type PlannerEvaluationsResponse,
  type PlannerProvidersResponse,
  plannerAttemptsResponseSchema,
  plannerEvaluationsResponseSchema,
  plannerProvidersResponseSchema,
  type RuntimeObservation,
  runtimeObservationSchema,
  type TaskPlanRequest,
  type TaskPlanResponse,
  type TaskRunView,
  type TaskSpec,
  taskPlanResponseSchema,
  taskRunViewSchema,
  type WorkstationSnapshot,
  workstationSnapshotSchema,
} from "@ergopilot/contracts";
import type { AppType } from "@ergopilot/control-plane";
import { isTauri, invoke as tauriInvoke } from "@tauri-apps/api/core";
import { hc } from "hono/client";
import { z } from "zod";

const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
const stationCommandErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

type PlannerControlPlane = Pick<
  ControlPlane,
  "plannerAttempts" | "plannerEvaluations" | "plannerProviders" | "planTask"
>;
type InvokeCommand = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export class ControlPlaneError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ControlPlaneError";
  }
}

export interface ControlPlane {
  plannerAttempts(): Promise<PlannerAttemptsResponse>;
  plannerEvaluations(): Promise<PlannerEvaluationsResponse>;
  plannerProviders(): Promise<PlannerProvidersResponse>;
  planTask(request: TaskPlanRequest): Promise<TaskPlanResponse>;
  startTask(task: TaskSpec): Promise<TaskRunView>;
  inspectTask(runId: string): Promise<TaskRunView>;
  approveTask(runId: string, approvedBy: string): Promise<TaskRunView>;
  cancelTask(runId: string, cancelledBy: string): Promise<TaskRunView>;
  demoApproveTaskWithAckLoss(
    runId: string,
    approvedBy: string,
  ): Promise<TaskRunView>;
  demoApproveTaskWithDeviceOffline(
    runId: string,
    approvedBy: string,
  ): Promise<TaskRunView>;
  demoApproveTaskWithActuatorJam(
    runId: string,
    approvedBy: string,
  ): Promise<TaskRunView>;
  demoApproveTaskWithDeviceUnavailableBeforeDispatch(
    runId: string,
    approvedBy: string,
  ): Promise<TaskRunView>;
  resumeTask(runId: string): Promise<TaskRunView>;
  reconcileTask(runId: string): Promise<TaskRunView>;
  stationSnapshot(): Promise<WorkstationSnapshot>;
  subscribeTaskRun(
    runId: string,
    onObservation: (observation: RuntimeObservation) => void,
    onError?: () => void,
  ): () => void;
}

export class HonoControlPlane implements ControlPlane {
  readonly #baseUrl: string;
  readonly #client;

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
    this.#client = hc<AppType>(this.#baseUrl);
  }

  async plannerAttempts(): Promise<PlannerAttemptsResponse> {
    const response = await this.#client.api["planner-attempts"].$get();
    return parseResponse(response, plannerAttemptsResponseSchema);
  }

  async plannerEvaluations(): Promise<PlannerEvaluationsResponse> {
    const response = await this.#client.api["planner-evaluations"].$get();
    return parseResponse(response, plannerEvaluationsResponseSchema);
  }

  async plannerProviders(): Promise<PlannerProvidersResponse> {
    const response = await this.#client.api["planner-providers"].$get();
    return parseResponse(response, plannerProvidersResponseSchema);
  }

  async planTask(request: TaskPlanRequest): Promise<TaskPlanResponse> {
    const response = await this.#client.api["task-plans"].$post({
      json: request,
    });
    return parseResponse(response, taskPlanResponseSchema);
  }

  async startTask(task: TaskSpec): Promise<TaskRunView> {
    const response = await this.#client.api["task-runs"].$post({ json: task });
    return parseResponse(response, taskRunViewSchema);
  }

  async inspectTask(runId: string): Promise<TaskRunView> {
    const response = await this.#client.api["task-runs"][":runId"].$get({
      param: { runId },
    });
    return parseResponse(response, taskRunViewSchema);
  }

  async approveTask(runId: string, approvedBy: string): Promise<TaskRunView> {
    const response = await this.#client.api["task-runs"][
      ":runId"
    ].approve.$post({
      param: { runId },
      json: { approvedBy },
    });
    return parseResponse(response, taskRunViewSchema);
  }

  async cancelTask(runId: string, cancelledBy: string): Promise<TaskRunView> {
    const response = await this.#client.api["task-runs"][":runId"].cancel.$post(
      {
        param: { runId },
        json: { cancelledBy },
      },
    );
    return parseResponse(response, taskRunViewSchema);
  }

  async demoApproveTaskWithAckLoss(
    runId: string,
    approvedBy: string,
  ): Promise<TaskRunView> {
    const response = await this.#client.api.demo["task-runs"][":runId"][
      "approve-with-ack-loss"
    ].$post({
      param: { runId },
      json: { approvedBy },
    });
    return parseResponse(response, taskRunViewSchema);
  }

  async demoApproveTaskWithDeviceOffline(
    runId: string,
    approvedBy: string,
  ): Promise<TaskRunView> {
    const response = await this.#client.api.demo["task-runs"][":runId"][
      "approve-with-device-offline"
    ].$post({
      param: { runId },
      json: { approvedBy },
    });
    return parseResponse(response, taskRunViewSchema);
  }

  async demoApproveTaskWithActuatorJam(
    runId: string,
    approvedBy: string,
  ): Promise<TaskRunView> {
    const response = await this.#client.api.demo["task-runs"][":runId"][
      "approve-with-actuator-jam"
    ].$post({
      param: { runId },
      json: { approvedBy },
    });
    return parseResponse(response, taskRunViewSchema);
  }

  async demoApproveTaskWithDeviceUnavailableBeforeDispatch(
    runId: string,
    approvedBy: string,
  ): Promise<TaskRunView> {
    const response = await this.#client.api.demo["task-runs"][":runId"][
      "approve-with-device-unavailable-before-dispatch"
    ].$post({
      param: { runId },
      json: { approvedBy },
    });
    return parseResponse(response, taskRunViewSchema);
  }

  async reconcileTask(runId: string): Promise<TaskRunView> {
    const response = await this.#client.api["task-runs"][
      ":runId"
    ].reconcile.$post({ param: { runId } });
    return parseResponse(response, taskRunViewSchema);
  }

  async resumeTask(runId: string): Promise<TaskRunView> {
    const response = await this.#client.api["task-runs"][":runId"].resume.$post(
      { param: { runId } },
    );
    return parseResponse(response, taskRunViewSchema);
  }

  async stationSnapshot(): Promise<WorkstationSnapshot> {
    const response = await this.#client.api.station.snapshot.$get();
    return parseResponse(response, workstationSnapshotSchema);
  }

  subscribeTaskRun(
    runId: string,
    onObservation: (observation: RuntimeObservation) => void,
    onError: () => void = () => undefined,
  ) {
    if (typeof EventSource === "undefined") {
      onError();
      return () => undefined;
    }

    const source = new EventSource(
      `${this.#baseUrl}/api/task-runs/${encodeURIComponent(runId)}/stream`,
    );
    source.addEventListener("observation", (event) => {
      const message = event as MessageEvent<string>;
      const observation = parseRuntimeObservation(message.data);
      if (observation) onObservation(observation);
      else onError();
    });
    source.addEventListener("error", onError);
    return () => source.close();
  }
}

export class TauriControlPlane implements ControlPlane {
  constructor(
    readonly planner: PlannerControlPlane,
    readonly invokeCommand: InvokeCommand = tauriInvoke,
    readonly now: () => number = Date.now,
    readonly pollIntervalMs = 100,
  ) {}

  plannerAttempts(): Promise<PlannerAttemptsResponse> {
    return this.planner.plannerAttempts();
  }

  plannerEvaluations(): Promise<PlannerEvaluationsResponse> {
    return this.planner.plannerEvaluations();
  }

  plannerProviders(): Promise<PlannerProvidersResponse> {
    return this.planner.plannerProviders();
  }

  planTask(request: TaskPlanRequest): Promise<TaskPlanResponse> {
    return this.planner.planTask(request);
  }

  startTask(task: TaskSpec): Promise<TaskRunView> {
    return this.invokeStation(
      { method: "task.start", params: { task, nowMs: this.now() } },
      taskRunViewSchema,
    );
  }

  inspectTask(runId: string): Promise<TaskRunView> {
    return this.invokeStation(
      { method: "task.inspect", params: { runId } },
      taskRunViewSchema,
    );
  }

  approveTask(runId: string, approvedBy: string): Promise<TaskRunView> {
    return this.invokeStation(
      {
        method: "task.approve",
        params: { runId, approvedBy, nowMs: this.now() },
      },
      taskRunViewSchema,
    );
  }

  cancelTask(runId: string, cancelledBy: string): Promise<TaskRunView> {
    return this.invokeStation(
      {
        method: "task.cancel",
        params: { runId, cancelledBy, nowMs: this.now() },
      },
      taskRunViewSchema,
    );
  }

  demoApproveTaskWithAckLoss(
    runId: string,
    approvedBy: string,
  ): Promise<TaskRunView> {
    return this.invokeStation(
      {
        method: "demo.task.approve_with_ack_loss",
        params: { runId, approvedBy, nowMs: this.now() },
      },
      taskRunViewSchema,
    );
  }

  demoApproveTaskWithDeviceOffline(
    runId: string,
    approvedBy: string,
  ): Promise<TaskRunView> {
    return this.invokeStation(
      {
        method: "demo.task.approve_with_device_offline",
        params: { runId, approvedBy, nowMs: this.now() },
      },
      taskRunViewSchema,
    );
  }

  demoApproveTaskWithActuatorJam(
    runId: string,
    approvedBy: string,
  ): Promise<TaskRunView> {
    return this.invokeStation(
      {
        method: "demo.task.approve_with_actuator_jam",
        params: { runId, approvedBy, nowMs: this.now() },
      },
      taskRunViewSchema,
    );
  }

  demoApproveTaskWithDeviceUnavailableBeforeDispatch(
    runId: string,
    approvedBy: string,
  ): Promise<TaskRunView> {
    return this.invokeStation(
      {
        method: "demo.task.approve_with_device_unavailable_before_dispatch",
        params: { runId, approvedBy, nowMs: this.now() },
      },
      taskRunViewSchema,
    );
  }

  resumeTask(runId: string): Promise<TaskRunView> {
    return this.invokeStation(
      { method: "task.resume", params: { runId, nowMs: this.now() } },
      taskRunViewSchema,
    );
  }

  reconcileTask(runId: string): Promise<TaskRunView> {
    return this.invokeStation(
      { method: "task.reconcile", params: { runId, nowMs: this.now() } },
      taskRunViewSchema,
    );
  }

  stationSnapshot(): Promise<WorkstationSnapshot> {
    return this.invokeStation(
      {
        method: "station.snapshot",
        params: { observedAtMs: this.now() },
      },
      workstationSnapshotSchema,
    );
  }

  subscribeTaskRun(
    runId: string,
    onObservation: (observation: RuntimeObservation) => void,
    onError: () => void = () => undefined,
  ) {
    let active = true;
    let polling = false;
    const poll = async () => {
      if (!active || polling) return;
      polling = true;
      try {
        const [run, station] = await Promise.all([
          this.inspectTask(runId),
          this.stationSnapshot(),
        ]);
        if (active)
          onObservation(runtimeObservationSchema.parse({ run, station }));
      } catch {
        if (active) onError();
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), this.pollIntervalMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }

  private async invokeStation<T>(
    request: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    try {
      const result = await this.invokeCommand<unknown>("station_rpc", {
        request,
      });
      return schema.parse(result);
    } catch (error) {
      if (error instanceof z.ZodError) throw error;
      const parsed = stationCommandErrorSchema.safeParse(error);
      if (parsed.success) {
        throw new ControlPlaneError(parsed.data.code, parsed.data.message);
      }
      throw new ControlPlaneError(
        "station_rpc_error",
        error instanceof Error
          ? error.message
          : "Desktop station command failed",
      );
    }
  }
}

function parseRuntimeObservation(data: string) {
  try {
    const result = runtimeObservationSchema.safeParse(JSON.parse(data));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

async function parseResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<T> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    if (parsed.success) {
      throw new ControlPlaneError(
        parsed.data.error.code,
        parsed.data.error.message,
      );
    }
    throw new ControlPlaneError(
      "invalid_error_response",
      `Control plane returned HTTP ${response.status}`,
    );
  }
  return schema.parse(body);
}

export function createControlPlane(): ControlPlane {
  const hono = new HonoControlPlane(
    import.meta.env.VITE_CONTROL_PLANE_URL ?? "http://localhost:8787",
  );
  return isTauri() ? new TauriControlPlane(hono) : hono;
}

export const controlPlane = createControlPlane();
