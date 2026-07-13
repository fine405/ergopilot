import {
  type TaskSpec,
  workstationCapabilityCatalog,
} from "@ergopilot/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  ControlPlaneHttpError,
  HttpErgoPilotControlPlane,
} from "./control-plane-client";
import { createAwaitingApprovalRun } from "./test-fixtures";

describe("HTTP control-plane adapter", () => {
  it("reads and validates the capability catalog", async () => {
    const fetchImplementation = vi.fn(async () =>
      Response.json(workstationCapabilityCatalog),
    );
    const controlPlane = new HttpErgoPilotControlPlane(
      "http://localhost:8787/",
      fetchImplementation,
    );

    await expect(controlPlane.listCapabilities()).resolves.toEqual(
      workstationCapabilityCatalog,
    );
    expect(fetchImplementation).toHaveBeenCalledWith(
      "http://localhost:8787/api/capabilities",
      {
        headers: { accept: "application/json" },
      },
    );
  });

  it("preserves a safe control-plane error without returning invalid data", async () => {
    const controlPlane = new HttpErgoPilotControlPlane(
      "http://localhost:8787",
      vi.fn(async () =>
        Response.json(
          { error: { code: "forbidden", message: "request denied" } },
          { status: 403 },
        ),
      ),
    );

    await expect(controlPlane.getState()).rejects.toEqual(
      new ControlPlaneHttpError(403, "request denied"),
    );
  });

  it("posts the exact TaskSpec and validates the returned run", async () => {
    const run = createAwaitingApprovalRun(task);
    const fetchImplementation = vi.fn(async () => Response.json(run));
    const controlPlane = new HttpErgoPilotControlPlane(
      "http://localhost:8787",
      fetchImplementation,
    );

    await expect(controlPlane.proposeTask(task)).resolves.toEqual(run);
    expect(fetchImplementation).toHaveBeenCalledWith(
      "http://localhost:8787/api/task-runs",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(task),
      },
    );
  });

  it("encodes a run identifier and validates inspection evidence", async () => {
    const fetchImplementation = vi.fn(async () => Response.json({}));
    const controlPlane = new HttpErgoPilotControlPlane(
      "http://localhost:8787",
      fetchImplementation,
    );

    await expect(controlPlane.inspectRun("run/unsafe path")).rejects.toThrow();
    expect(fetchImplementation).toHaveBeenCalledWith(
      "http://localhost:8787/api/task-runs/run%2Funsafe%20path",
      { headers: { accept: "application/json" } },
    );
  });
});

const task: TaskSpec = {
  schemaVersion: 1,
  taskId: "task-http-1",
  goal: "prepare_focus_session",
  requestedBy: "user-1",
  constraints: {},
  assumptions: [],
  steps: [
    {
      stepId: "desk-1",
      action: {
        type: "desk.move_to_height",
        input: { heightMm: 780 },
      },
    },
  ],
};
