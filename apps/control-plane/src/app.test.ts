import type {
  TaskRunView,
  TaskSpec,
  WorkstationSnapshot,
} from "@ergopilot/contracts";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app";
import type { StationClient } from "./station-client";

const awaitingRun: TaskRunView = {
  runId: "run-task-api-1",
  taskId: "task-api-1",
  task: {
    schemaVersion: 1,
    taskId: "task-api-1",
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
  },
  status: "awaiting_approval",
  approval: {
    approvalId: "approval-run-task-api-1",
    expiresAtMs: 61_000,
    status: "pending",
    approvedBy: null,
    approvedAtMs: null,
  },
  command: null,
  commandEvents: [],
  events: [
    { sequence: 1, eventType: "run_started", atMs: 1_000 },
    { sequence: 2, eventType: "approval_required", atMs: 1_000 },
  ],
  policyDecision: {
    outcome: "require_approval",
    ruleIds: ["desk.motion.requires_approval"],
    reasonCode: null,
  },
};

const task: TaskSpec = {
  schemaVersion: 1,
  taskId: "task-api-1",
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

describe("control-plane API", () => {
  it("validates and starts a TaskSpec with the server clock", async () => {
    const station = fakeStation();
    const app = createApp(station, { now: () => 1_000 });

    const response = await app.request("/api/task-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(task),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(awaitingRun);
    expect(station.startTask).toHaveBeenCalledWith(task, 1_000);
  });

  it("rejects an invalid plan before invoking the station", async () => {
    const station = fakeStation();
    const app = createApp(station, { now: () => 1_000 });

    const response = await app.request("/api/task-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...task, steps: [] }),
    });

    expect(response.status).toBe(400);
    expect(station.startTask).not.toHaveBeenCalled();
  });

  it("rejects values that cannot cross the Rust TaskSpec contract", async () => {
    const station = fakeStation();
    const app = createApp(station, { now: () => 1_000 });

    const response = await app.request("/api/task-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...task,
        constraints: { durationMinutes: 65_536 },
      }),
    });

    expect(response.status).toBe(400);
    expect(station.startTask).not.toHaveBeenCalled();
  });

  it("rejects an oversized body before invoking the station", async () => {
    const station = fakeStation();
    const app = createApp(station, { now: () => 1_000 });

    const response = await app.request("/api/task-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...task,
        assumptions: ["x".repeat(70 * 1024)],
      }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: {
        code: "payload_too_large",
        message: "request body exceeds 64 KiB",
      },
    });
    expect(station.startTask).not.toHaveBeenCalled();
  });

  it("requires an explicit approver and uses the server clock", async () => {
    const station = fakeStation();
    const app = createApp(station, { now: () => 1_100 });

    const response = await app.request(
      "/api/task-runs/run-task-api-1/approve",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvedBy: "user-1" }),
      },
    );

    expect(response.status).toBe(200);
    expect(station.approveTask).toHaveBeenCalledWith(
      "run-task-api-1",
      "user-1",
      1_100,
    );
  });
});

function fakeStation(): StationClient {
  const snapshot: WorkstationSnapshot = {
    schemaVersion: 1,
    stationId: "station-sim-1",
    stateVersion: 1,
    observedAtMs: 1_000,
    deskHeightMm: 720,
    movementCount: 0,
  };
  return {
    startTask: vi.fn(async () => awaitingRun),
    inspectTask: vi.fn(async () => awaitingRun),
    approveTask: vi.fn(async () => ({
      ...awaitingRun,
      status: "completed" as const,
    })),
    reconcileTask: vi.fn(async () => awaitingRun),
    stationSnapshot: vi.fn(async () => snapshot),
  };
}
