import {
  type RuntimeObservation,
  type TaskPlanResponse,
  type TaskRunView,
  type TaskSpec,
  type WorkstationSnapshot,
  workstationCapabilityCatalog,
} from "@ergopilot/contracts";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app";
import { createMemoryPlannerAttemptStore } from "./planner-attempt-store";
import {
  type StationClient,
  StationRpcError,
  type StationRpcErrorCode,
} from "./station-client";
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
  suspensionReason: null,
  approval: {
    approvalId: "approval-run-task-api-1",
    expiresAtMs: 61_000,
    status: "pending",
    approvedBy: null,
    approvedAtMs: null,
  },
  command: null,
  commandEvents: [],
  deskMotionProgress: [],
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
  it("exposes the versioned device capability catalog", async () => {
    const response = await createApp(fakeStation()).request(
      "/api/capabilities",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(workstationCapabilityCatalog);
  });

  it("streams validated task and station observations", async () => {
    const station = fakeStation();
    const executingRun: TaskRunView = {
      ...awaitingRun,
      status: "executing",
      deskMotionProgress: [
        {
          sequence: 1,
          commandId: "command-run-task-api-1",
          progressPercent: 50,
          deskHeightMm: 750,
          atMs: 1_050,
        },
      ],
    };
    const completedRun: TaskRunView = {
      ...awaitingRun,
      status: "completed",
      deskMotionProgress: [
        {
          sequence: 1,
          commandId: "command-run-task-api-1",
          progressPercent: 100,
          deskHeightMm: 780,
          atMs: 1_100,
        },
      ],
    };
    vi.mocked(station.inspectTask)
      .mockResolvedValueOnce(executingRun)
      .mockResolvedValueOnce(completedRun);
    vi.mocked(station.stationSnapshot).mockResolvedValue({
      schemaVersion: 1,
      stationId: "station-sim-1",
      stateVersion: 2,
      observedAtMs: 1_100,
      deskHeightMm: 780,
      lumbarSupportPercent: 35,
      movementCount: 1,
    });
    const app = createApp(station, { now: () => 1_100 });

    const response = await app.request("/api/task-runs/run-task-api-1/stream");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain("event: observation");
    expect(body).toContain('"progressPercent":100');
    const observations = body
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as RuntimeObservation);
    expect(observations[0]?.station.deskHeightMm).toBe(750);
    expect(observations.at(-1)?.station.deskHeightMm).toBe(780);
    expect(station.inspectTask).toHaveBeenCalledWith("run-task-api-1");
    expect(station.stationSnapshot).toHaveBeenCalledWith(1_100);
  });

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

  it("restores planner attempts when a new app uses the same store", async () => {
    const plannerAttemptStore = createMemoryPlannerAttemptStore();
    const firstApp = createApp(fakeStation(), {
      plannerAttemptStore,
      planners: { deepseek: fakePlanner() },
    });
    await firstApp.request("/api/task-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "deepseek",
        prompt: "Prepare a persisted trace",
        requestedBy: "user-1",
      }),
    });

    const restartedApp = createApp(fakeStation(), { plannerAttemptStore });
    const response = await restartedApp.request("/api/planner-attempts");

    expect(await response.json()).toMatchObject({
      attempts: [
        {
          provider: "deepseek",
          outcome: "succeeded",
          taskId: "task-api-1",
        },
      ],
    });
  });

  it("fails closed without exposing storage details when trace persistence fails", async () => {
    const planner = fakePlanner();
    const app = createApp(fakeStation(), {
      plannerAttemptStore: {
        list: () => [],
        record: vi.fn(async () => {
          throw new Error("sensitive path: /private/trace-store.json");
        }),
      },
      planners: { deepseek: planner },
    });

    const response = await app.request("/api/task-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "deepseek",
        prompt: "Prepare a plan with durable evidence",
        requestedBy: "user-1",
      }),
    });

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "trace_persistence_failed",
        message: "planner attempt evidence could not be persisted",
      },
    });
    expect(JSON.stringify(body)).not.toContain("/private/trace-store.json");
    expect(planner.plan).toHaveBeenCalledOnce();

    const malformedResponse = await app.request("/api/task-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"provider":"deepseek"',
    });
    expect(malformedResponse.status).toBe(503);
    expect(await malformedResponse.json()).toEqual(body);
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

  it("does not misclassify a planner HTTP error as request validation", async () => {
    const planner: TaskPlanner = {
      plan: vi.fn(async () => {
        throw new HTTPException(400, { message: "planner HTTP failure" });
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

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "internal_error", message: "planner HTTP failure" },
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
          errorCode: "internal_error",
        },
      ],
    });
  });

  it("records an unattributed attempt when the planner provider is invalid", async () => {
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_005);
    const app = createApp(fakeStation(), { now });

    const response = await app.request("/api/task-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "unknown-provider",
        prompt: "private invalid request",
        requestedBy: "private-user",
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_request",
        message: "request body does not match TaskPlanRequest",
      },
    });
    const traceId = response.headers.get("X-ErgoPilot-Trace-Id");
    const attemptsResponse = await app.request("/api/planner-attempts");
    const body = await attemptsResponse.json();
    expect(body).toEqual({
      attempts: [
        {
          traceId,
          provider: null,
          model: null,
          startedAtMs: 1_000,
          durationMs: 5,
          outcome: "failed",
          taskId: null,
          errorCode: "invalid_request",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("private invalid request");
    expect(JSON.stringify(body)).not.toContain("private-user");
  });

  it("attributes an invalid planner body when its provider is valid", async () => {
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(2_007);
    const app = createApp(fakeStation(), { now });

    const response = await app.request("/api/task-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "deepseek",
        prompt: "",
        requestedBy: "user-1",
      }),
    });

    expect(response.status).toBe(400);
    const traceId = response.headers.get("X-ErgoPilot-Trace-Id");
    const attemptsResponse = await app.request("/api/planner-attempts");
    expect(await attemptsResponse.json()).toEqual({
      attempts: [
        {
          traceId,
          provider: "deepseek",
          model: "deepseek/deepseek-v4-flash",
          startedAtMs: 2_000,
          durationMs: 7,
          outcome: "failed",
          taskId: null,
          errorCode: "invalid_request",
        },
      ],
    });
  });

  it("records malformed planner JSON as an invalid request", async () => {
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(3_000)
      .mockReturnValueOnce(3_004);
    const app = createApp(fakeStation(), { now });

    const response = await app.request("/api/task-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"provider":"deepseek"',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_request",
        message: "request body does not match TaskPlanRequest",
      },
    });
    const traceId = response.headers.get("X-ErgoPilot-Trace-Id");
    const attemptsResponse = await app.request("/api/planner-attempts");
    expect(await attemptsResponse.json()).toEqual({
      attempts: [
        {
          traceId,
          provider: null,
          model: null,
          startedAtMs: 3_000,
          durationMs: 4,
          outcome: "failed",
          taskId: null,
          errorCode: "invalid_request",
        },
      ],
    });
  });

  it("records an oversized planner body before rejecting it", async () => {
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(4_000)
      .mockReturnValueOnce(4_003);
    const app = createApp(fakeStation(), { now });

    const response = await app.request("/api/task-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "deepseek",
        prompt: "x".repeat(70 * 1024),
        requestedBy: "user-1",
      }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: {
        code: "payload_too_large",
        message: "request body exceeds 64 KiB",
      },
    });
    const traceId = response.headers.get("X-ErgoPilot-Trace-Id");
    const attemptsResponse = await app.request("/api/planner-attempts");
    expect(await attemptsResponse.json()).toEqual({
      attempts: [
        {
          traceId,
          provider: null,
          model: null,
          startedAtMs: 4_000,
          durationMs: 3,
          outcome: "failed",
          taskId: null,
          errorCode: "payload_too_large",
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

  it("keeps ACK-loss injection behind an explicit demo route", async () => {
    const station = fakeStation();
    const app = createApp(station, { now: () => 1_100 });

    const response = await app.request(
      "/api/demo/task-runs/run-task-api-1/approve-with-ack-loss",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvedBy: "user-1" }),
      },
    );

    expect(response.status).toBe(200);
    expect(station.demoApproveTaskWithAckLoss).toHaveBeenCalledWith(
      "run-task-api-1",
      "user-1",
      1_100,
    );
    expect(station.approveTask).not.toHaveBeenCalled();
  });

  it("keeps device-offline injection behind an explicit demo route", async () => {
    const station = fakeStation();
    const app = createApp(station, { now: () => 1_100 });

    const response = await app.request(
      "/api/demo/task-runs/run-task-api-1/approve-with-device-offline",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvedBy: "user-1" }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "failed" });
    expect(station.demoApproveTaskWithDeviceOffline).toHaveBeenCalledWith(
      "run-task-api-1",
      "user-1",
      1_100,
    );
    expect(station.approveTask).not.toHaveBeenCalled();
  });

  it("keeps pre-dispatch unavailability behind an explicit demo route", async () => {
    const station = fakeStation();
    const app = createApp(station, { now: () => 1_100 });

    const response = await app.request(
      "/api/demo/task-runs/run-task-api-1/approve-with-device-unavailable-before-dispatch",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvedBy: "user-1" }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "suspended",
      suspensionReason: "device_unavailable",
    });
    expect(
      station.demoApproveTaskWithDeviceUnavailableBeforeDispatch,
    ).toHaveBeenCalledWith("run-task-api-1", "user-1", 1_100);
    expect(station.approveTask).not.toHaveBeenCalled();
  });

  it("exposes resume separately from reconciliation", async () => {
    const station = fakeStation();
    const app = createApp(station, { now: () => 1_200 });

    const response = await app.request("/api/task-runs/run-task-api-1/resume", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(station.resumeTask).toHaveBeenCalledWith("run-task-api-1", 1_200);
    expect(station.reconcileTask).not.toHaveBeenCalled();
  });

  it("cancels a pending run for the named requester", async () => {
    const station = fakeStation();
    const app = createApp(station, { now: () => 1_050 });

    const response = await app.request("/api/task-runs/run-task-api-1/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cancelledBy: "user-1" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "cancelled" });
    expect(station.cancelTask).toHaveBeenCalledWith(
      "run-task-api-1",
      "user-1",
      1_050,
    );
  });

  it.each([
    ["invalid_request", 400],
    ["forbidden", 403],
    ["run_not_found", 404],
    ["task_conflict", 409],
    ["invalid_transition", 409],
    ["approval_expired", 409],
    ["recovery_budget_exhausted", 409],
    ["device_unavailable", 503],
    ["station_rpc_error", 502],
    ["output_limit", 502],
    ["timeout", 504],
    ["spawn_failed", 502],
    ["unexpected_exit", 502],
    ["invalid_response", 502],
  ] satisfies ReadonlyArray<
    readonly [StationRpcErrorCode, number]
  >)("maps station error %s to HTTP %i", async (code, status) => {
    const station = fakeStation();
    station.inspectTask = vi.fn(async () => {
      throw new StationRpcError(code, "station request failed");
    });
    const app = createApp(station);

    const response = await app.request("/api/task-runs/run-test");

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      error: { code, message: "station request failed" },
    });
  });

  it("keeps uncertain-outcome reconciliation on its own route", async () => {
    const station = fakeStation();
    const app = createApp(station, { now: () => 1_200 });

    const response = await app.request(
      "/api/task-runs/run-task-api-1/reconcile",
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(station.reconcileTask).toHaveBeenCalledWith("run-task-api-1", 1_200);
    expect(station.resumeTask).not.toHaveBeenCalled();
  });
});

function fakeStation(): StationClient {
  const snapshot: WorkstationSnapshot = {
    schemaVersion: 1,
    stationId: "station-sim-1",
    stateVersion: 1,
    observedAtMs: 1_000,
    deskHeightMm: 720,
    lumbarSupportPercent: 35,
    movementCount: 0,
  };
  return {
    startTask: vi.fn(async () => awaitingRun),
    inspectTask: vi.fn(async () => awaitingRun),
    approveTask: vi.fn(async () => ({
      ...awaitingRun,
      status: "completed" as const,
    })),
    demoApproveTaskWithAckLoss: vi.fn(async () => ({
      ...awaitingRun,
      status: "outcome_unknown" as const,
    })),
    demoApproveTaskWithDeviceOffline: vi.fn(async () => ({
      ...awaitingRun,
      status: "failed" as const,
    })),
    demoApproveTaskWithDeviceUnavailableBeforeDispatch: vi.fn(async () => ({
      ...awaitingRun,
      status: "suspended" as const,
      suspensionReason: "device_unavailable" as const,
    })),
    cancelTask: vi.fn(async () => ({
      ...awaitingRun,
      status: "cancelled" as const,
      approval: awaitingRun.approval && {
        ...awaitingRun.approval,
        status: "cancelled" as const,
      },
      events: [
        ...awaitingRun.events,
        { sequence: 3, eventType: "run_cancelled" as const, atMs: 1_050 },
      ],
    })),
    resumeTask: vi.fn(async () => awaitingRun),
    reconcileTask: vi.fn(async () => awaitingRun),
    stationSnapshot: vi.fn(async () => snapshot),
  };
}

function fakePlanner(): TaskPlanner {
  return { plan: vi.fn(async () => plannedTask) };
}
