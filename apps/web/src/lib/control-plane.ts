import {
  type PlannerAttemptsResponse,
  type PlannerProvidersResponse,
  plannerAttemptsResponseSchema,
  plannerProvidersResponseSchema,
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
import { hc } from "hono/client";
import { z } from "zod";

const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

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
  demoApproveTaskWithDeviceUnavailableBeforeDispatch(
    runId: string,
    approvedBy: string,
  ): Promise<TaskRunView>;
  resumeTask(runId: string): Promise<TaskRunView>;
  reconcileTask(runId: string): Promise<TaskRunView>;
  stationSnapshot(): Promise<WorkstationSnapshot>;
}

export class HonoControlPlane implements ControlPlane {
  readonly #client;

  constructor(baseUrl: string) {
    this.#client = hc<AppType>(baseUrl);
  }

  async plannerAttempts(): Promise<PlannerAttemptsResponse> {
    const response = await this.#client.api["planner-attempts"].$get();
    return parseResponse(response, plannerAttemptsResponseSchema);
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

export const controlPlane = new HonoControlPlane(
  import.meta.env.VITE_CONTROL_PLANE_URL ?? "http://localhost:8787",
);
