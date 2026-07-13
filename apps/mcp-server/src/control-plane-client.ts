import {
  type CapabilityCatalogResponse,
  capabilityCatalogResponseSchema,
  type TaskRunView,
  type TaskSpec,
  taskRunViewSchema,
  type WorkstationSnapshot,
  workstationSnapshotSchema,
} from "@ergopilot/contracts";
import { z } from "zod";

import type { ErgoPilotControlPlane } from "./server";

const errorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
  }),
});

export class ControlPlaneHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ControlPlaneHttpError";
  }
}

export class HttpErgoPilotControlPlane implements ErgoPilotControlPlane {
  readonly #baseUrl: URL;
  readonly #fetch: typeof fetch;

  constructor(baseUrl: string, fetchImplementation: typeof fetch = fetch) {
    this.#baseUrl = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    this.#fetch = fetchImplementation;
  }

  listCapabilities(): Promise<CapabilityCatalogResponse> {
    return this.#request(
      "api/capabilities",
      { headers: { accept: "application/json" } },
      capabilityCatalogResponseSchema,
    );
  }

  getState(): Promise<WorkstationSnapshot> {
    return this.#request(
      "api/station/snapshot",
      { headers: { accept: "application/json" } },
      workstationSnapshotSchema,
    );
  }

  proposeTask(task: TaskSpec): Promise<TaskRunView> {
    return this.#request(
      "api/task-runs",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(task),
      },
      taskRunViewSchema,
    );
  }

  inspectRun(runId: string): Promise<TaskRunView> {
    return this.#request(
      `api/task-runs/${encodeURIComponent(runId)}`,
      { headers: { accept: "application/json" } },
      taskRunViewSchema,
    );
  }

  async #request<T>(
    path: string,
    init: RequestInit,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const response = await this.#fetch(
      new URL(path, this.#baseUrl).toString(),
      init,
    );
    const body: unknown = await response.json();
    if (!response.ok) {
      const parsedError = errorResponseSchema.safeParse(body);
      throw new ControlPlaneHttpError(
        response.status,
        parsedError.success
          ? parsedError.data.error.message
          : `control plane request failed with status ${response.status}`,
      );
    }
    return schema.parse(body);
  }
}
