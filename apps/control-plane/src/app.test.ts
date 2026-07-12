import type {
  TaskPlanResponse,
  TaskRunView,
  TaskSpec,
  WorkstationSnapshot,
} from "@ergopilot/contracts";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app";
import type { StationClient } from "./station-client";
import { PlannerError, type TaskPlanner } from "./task-planner";

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

const plannedTask: TaskPlanResponse = {
  task,
  planner: {
    framework: "mastra",
    provider: "deepseek",
    model: "deepseek/deepseek-v4-flash",
  },
};

describe("control-plane API", () => {
  it("reports configured and disabled planner providers", async () => {
    const app = createApp(fakeStation(), {
      planners: { deepseek: fakePlanner() },
    });

    const response = await app.request("/api/planner-providers");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      providers: [
        {
          id: "openai",
          name: "OpenAI",
          model: "openai/gpt-5.5",
          enabled: false,
        },
        {
          id: "deepseek",
          name: "DeepSeek",
          model: "deepseek/deepseek-v4-flash",
          enabled: true,
        },
      ],
    });
  });

  it("returns a validated agent plan without starting device execution", async () => {
    const station = fakeStation();
    const planner = fakePlanner();
    const app = createApp(station, { planners: { deepseek: planner } });

    const response = await app.request("/api/task-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "deepseek",
        prompt: "Prepare a 45 minute standing focus session",
        requestedBy: "user-1",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(plannedTask);
    expect(planner.plan).toHaveBeenCalledWith({
      provider: "deepseek",
      prompt: "Prepare a 45 minute standing focus session",
      requestedBy: "user-1",
    });
    expect(station.startTask).not.toHaveBeenCalled();
  });

  it("records privacy-safe evidence for a successful planning attempt", async () => {
    const planner = fakePlanner();
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_025);
    const app = createApp(fakeStation(), {
      now,
      planners: { deepseek: planner },
    });

    const planResponse = await app.request("/api/task-plans", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        provider: "deepseek",
        prompt: "Private workstation request",
        requestedBy: "private-user",
      }),
    });
    expect(planResponse.headers.get("Access-Control-Expose-Headers")).toBe(
      "X-ErgoPilot-Trace-Id",
    );
    const response = await app.request("/api/planner-attempts");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      attempts: [
        {
          traceId: expect.stringMatching(/^plan-/),
          provider: "deepseek",
          model: "deepseek/deepseek-v4-flash",
          startedAtMs: 1_000,
          durationMs: 25,
          outcome: "succeeded",
          taskId: "task-api-1",
          errorCode: null,
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("Private workstation request");
    expect(JSON.stringify(body)).not.toContain("private-user");
  });

  it("rejects a disabled provider without falling back to another one", async () => {
    const openai = fakePlanner();
    const app = createApp(fakeStation(), { planners: { openai } });

    const response = await app.request("/api/task-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "deepseek",
        prompt: "Prepare a focus session",
        requestedBy: "user-1",
      }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "provider_unavailable",
        message: "deepseek planner provider is not configured",
      },
    });
    expect(openai.plan).not.toHaveBeenCalled();
    const traceId = response.headers.get("X-ErgoPilot-Trace-Id");
    const attemptsResponse = await app.request("/api/planner-attempts");
    expect(await attemptsResponse.json()).toEqual({
      attempts: [
        {
          traceId,
          provider: "deepseek",
          model: "deepseek/deepseek-v4-flash",
          startedAtMs: expect.any(Number),
          durationMs: expect.any(Number),
          outcome: "failed",
          taskId: null,
          errorCode: "provider_unavailable",
        },
      ],
    });
  });

  it("returns a stable error when model output cannot form a plan", async () => {
    const planner: TaskPlanner = {
      plan: vi.fn(async () => {
        throw new PlannerError(
          "invalid_plan",
          "planner returned an invalid workstation plan",
        );
      }),
    };
    const app = createApp(fakeStation(), { planners: { deepseek: planner } });

    const response = await app.request("/api/task-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "deepseek",
        prompt: "Prepare a focus session",
        requestedBy: "user-1",
      }),
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_plan",
        message: "planner returned an invalid workstation plan",
      },
    });
    const traceId = response.headers.get("X-ErgoPilot-Trace-Id");
    const attemptsResponse = await app.request("/api/planner-attempts");
    expect(await attemptsResponse.json()).toEqual({
      attempts: [
        {
          traceId,
          provider: "deepseek",
          model: "deepseek/deepseek-v4-flash",
          startedAtMs: expect.any(Number),
          durationMs: expect.any(Number),
          outcome: "failed",
          taskId: null,
          errorCode: "invalid_plan",
        },
      ],
    });
  });

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

function fakePlanner(): TaskPlanner {
  return { plan: vi.fn(async () => plannedTask) };
}
