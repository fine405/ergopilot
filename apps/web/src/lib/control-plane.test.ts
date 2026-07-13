import { afterEach, describe, expect, it, vi } from "vitest";

import { HonoControlPlane, TauriControlPlane } from "./control-plane";

afterEach(() => vi.unstubAllGlobals());

describe("HonoControlPlane", () => {
  it("parses planner evaluation evidence from the control plane", async () => {
    const report = {
      schemaVersion: 1,
      generatedAt: "2026-07-13T01:24:01.271Z",
      suite: "full",
      provider: "deepseek",
      model: "deepseek/deepseek-v4-flash",
      sourceCommit: "67e43cd",
      totalCases: 1,
      passedCases: 1,
      passRate: 1,
      latencyMs: { p50: 2_860, p95: 2_860 },
      results: [
        {
          caseId: "standing-critical",
          passed: true,
          failures: [],
          durationMs: 2_860,
        },
      ],
    } as const;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ reports: [report] }, { status: 200 })),
    );

    await expect(
      new HonoControlPlane("http://localhost:8787").plannerEvaluations(),
    ).resolves.toEqual({ reports: [report] });
  });

  it("keeps realtime observations optional when EventSource is unavailable", () => {
    vi.stubGlobal("EventSource", undefined);
    const onObservation = vi.fn();
    const onError = vi.fn();

    const unsubscribe = new HonoControlPlane(
      "http://localhost:8787",
    ).subscribeTaskRun("run-1", onObservation, onError);

    expect(onObservation).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(unsubscribe()).toBeUndefined();
  });

  it("falls back without throwing when a realtime observation is malformed", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const onObservation = vi.fn();
    const onError = vi.fn();
    const unsubscribe = new HonoControlPlane(
      "http://localhost:8787/",
    ).subscribeTaskRun("run/1", onObservation, onError);
    const source = FakeEventSource.latest;

    source.emit("observation", new MessageEvent("observation", { data: "{" }));

    expect(source.url).toBe(
      "http://localhost:8787/api/task-runs/run%2F1/stream",
    );
    expect(onObservation).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(source.closed).toBe(false);

    unsubscribe();
    expect(source.closed).toBe(true);
  });
});

describe("TauriControlPlane", () => {
  it("routes station reads through the closed desktop command", async () => {
    const snapshot = {
      schemaVersion: 1 as const,
      stationId: "station-sim-1",
      stateVersion: 0,
      observedAtMs: 1_000,
      deskHeightMm: 720,
      lumbarSupportPercent: 35,
      movementCount: 0,
    };
    const invoke = vi.fn().mockResolvedValue(snapshot);
    const controlPlane = new TauriControlPlane(
      new HonoControlPlane("http://localhost:8787"),
      invoke,
      () => 1_000,
    );

    await expect(controlPlane.stationSnapshot()).resolves.toEqual(snapshot);
    expect(invoke).toHaveBeenCalledWith("station_rpc", {
      request: {
        method: "station.snapshot",
        params: { observedAtMs: 1_000 },
      },
    });
  });

  it("preserves structured desktop errors and approval parameters", async () => {
    const invoke = vi.fn().mockRejectedValue({
      code: "forbidden",
      message: "only the task owner can approve this run",
    });
    const controlPlane = new TauriControlPlane(
      new HonoControlPlane("http://localhost:8787"),
      invoke,
      () => 1_100,
    );

    await expect(
      controlPlane.approveTask("run-task-1", "user-2"),
    ).rejects.toMatchObject({
      name: "ControlPlaneError",
      code: "forbidden",
    });
    expect(invoke).toHaveBeenCalledWith("station_rpc", {
      request: {
        method: "task.approve",
        params: {
          runId: "run-task-1",
          approvedBy: "user-2",
          nowMs: 1_100,
        },
      },
    });
  });

  it("polls the durable desktop read model for live observations", async () => {
    const run = awaitingRun();
    const snapshot = {
      schemaVersion: 1 as const,
      stationId: "station-sim-1",
      stateVersion: 0,
      observedAtMs: 1_000,
      deskHeightMm: 720,
      lumbarSupportPercent: 35,
      movementCount: 0,
    };
    const invoke = vi
      .fn()
      .mockImplementation(
        async (_command: string, args: { request: { method: string } }) =>
          args.request.method === "task.inspect" ? run : snapshot,
      );
    const onObservation = vi.fn();
    const controlPlane = new TauriControlPlane(
      new HonoControlPlane("http://localhost:8787"),
      invoke,
      () => 1_000,
      60_000,
    );

    const unsubscribe = controlPlane.subscribeTaskRun(run.runId, onObservation);
    await vi.waitFor(() => expect(onObservation).toHaveBeenCalledOnce());
    unsubscribe();

    expect(onObservation).toHaveBeenCalledWith({ run, station: snapshot });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

function awaitingRun() {
  return {
    runId: "run-task-1",
    taskId: "task-1",
    task: {
      schemaVersion: 1 as const,
      taskId: "task-1",
      goal: "prepare_focus_session" as const,
      requestedBy: "user-1",
      constraints: {},
      assumptions: [],
      steps: [
        {
          stepId: "desk-1",
          action: {
            type: "desk.move_to_height" as const,
            input: { heightMm: 780 },
          },
        },
      ],
    },
    status: "awaiting_approval" as const,
    suspensionReason: null,
    approval: {
      approvalId: "approval-run-task-1",
      expiresAtMs: 61_000,
      status: "pending" as const,
      approvedBy: null,
      approvedAtMs: null,
    },
    command: null,
    commandEvents: [],
    deskMotionProgress: [],
    events: [
      { sequence: 1, eventType: "run_started" as const, atMs: 1_000 },
      {
        sequence: 2,
        eventType: "approval_required" as const,
        atMs: 1_000,
      },
    ],
    policyDecision: {
      outcome: "require_approval" as const,
      ruleIds: ["desk.motion.requires_approval"],
      reasonCode: null,
    },
  };
}

class FakeEventSource {
  static latest: FakeEventSource;
  readonly #listeners = new Map<string, EventListener>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.latest = this;
  }

  addEventListener(type: string, listener: EventListener) {
    this.#listeners.set(type, listener);
  }

  emit(type: string, event: Event) {
    this.#listeners.get(type)?.(event);
  }

  close() {
    this.closed = true;
  }
}
