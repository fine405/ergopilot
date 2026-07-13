// @vitest-environment jsdom

import type {
  RuntimeObservation,
  TaskPlanRequest,
  TaskPlanResponse,
  TaskRunView,
} from "@ergopilot/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OperatorConsole } from "./operator-console";

const controlPlaneMock = vi.hoisted(() => ({
  plannerAttempts: vi.fn(),
  plannerProviders: vi.fn(),
  planTask: vi.fn(),
  startTask: vi.fn(),
  inspectTask: vi.fn(),
  approveTask: vi.fn(),
  demoApproveTaskWithAckLoss: vi.fn(),
  demoApproveTaskWithDeviceOffline: vi.fn(),
  demoApproveTaskWithDeviceUnavailableBeforeDispatch: vi.fn(),
  cancelTask: vi.fn(),
  resumeTask: vi.fn(),
  reconcileTask: vi.fn(),
  stationSnapshot: vi.fn(),
  subscribeTaskRun: vi.fn(
    (
      _runId: string,
      _onObservation: (observation: RuntimeObservation) => void,
      _onError?: () => void,
    ) => vi.fn(),
  ),
}));

vi.mock("@tanstack/react-router", () => ({ useHydrated: () => true }));
vi.mock("@/lib/control-plane", () => ({ controlPlane: controlPlaneMock }));
vi.mock("./agent-planner-card", () => ({
  AgentPlannerCard: ({
    onGenerate,
  }: {
    onGenerate: (request: TaskPlanRequest) => Promise<TaskPlanResponse>;
  }) => {
    const [taskId, setTaskId] = useState("no plan");
    return (
      <div>
        <button
          type="button"
          onClick={() =>
            void onGenerate({
              provider: "deepseek",
              prompt: "Plan without waiting for trace refresh",
              requestedBy: "test-user",
            }).then((result) => setTaskId(result.task.taskId))
          }
        >
          Plan now
        </button>
        <span>{taskId}</span>
      </div>
    );
  },
}));
vi.mock("./planner-attempts-card", () => ({
  PlannerAttemptsCard: () => null,
}));
vi.mock("./run-overview", () => ({ RunOverview: () => null }));
vi.mock("./station-card", () => ({ StationCard: () => null }));
vi.mock("./task-composer", () => ({ TaskComposer: () => null }));
vi.mock("../workstation-twin/workstation-twin-card", () => ({
  WorkstationTwinCard: ({
    snapshot,
  }: {
    snapshot: { deskHeightMm: number } | undefined;
  }) => (
    <div>{snapshot ? `Twin ${snapshot.deskHeightMm} mm` : "Twin loading"}</div>
  ),
}));

const plannedTask: TaskPlanResponse = {
  task: {
    schemaVersion: 1,
    taskId: "task-plan-visible",
    goal: "prepare_focus_session",
    requestedBy: "test-user",
    constraints: {
      durationMinutes: 45,
      interruptionPolicy: "critical-only",
    },
    assumptions: [],
    steps: [
      {
        stepId: "desk-1",
        action: {
          type: "desk.move_to_height",
          input: { heightMm: 790 },
        },
      },
    ],
  },
  planner: {
    framework: "mastra",
    provider: "deepseek",
    model: "deepseek/deepseek-v4-flash",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  controlPlaneMock.plannerProviders.mockResolvedValue({ providers: [] });
  controlPlaneMock.stationSnapshot.mockResolvedValue({
    schemaVersion: 1,
    stationId: "station-test",
    stateVersion: 1,
    observedAtMs: 1_000,
    deskHeightMm: 720,
    movementCount: 0,
  });
  controlPlaneMock.planTask.mockResolvedValue(plannedTask);
  controlPlaneMock.plannerAttempts.mockResolvedValue({ attempts: [] });
});

afterEach(cleanup);

describe("OperatorConsole", () => {
  it("shows a completed plan without waiting for attempt refresh", async () => {
    controlPlaneMock.plannerAttempts
      .mockResolvedValueOnce({ attempts: [] })
      .mockImplementationOnce(() => new Promise(() => undefined));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <OperatorConsole runId={undefined} onRunIdChange={vi.fn()} />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(controlPlaneMock.plannerAttempts).toHaveBeenCalledOnce(),
    );
    await waitFor(() => expect(screen.getByText("Twin 720 mm")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Plan now" }));

    await waitFor(() =>
      expect(screen.getByText("task-plan-visible")).toBeTruthy(),
    );
    expect(controlPlaneMock.plannerAttempts).toHaveBeenCalledTimes(2);
  });

  it("subscribes an executing run after reload and applies observations", async () => {
    const executingRun: TaskRunView = {
      runId: "run-reloaded",
      taskId: plannedTask.task.taskId,
      task: plannedTask.task,
      status: "executing",
      suspensionReason: null,
      approval: {
        approvalId: "approval-run-reloaded",
        expiresAtMs: 61_000,
        status: "approved",
        approvedBy: "test-user",
        approvedAtMs: 1_100,
      },
      command: null,
      commandEvents: [],
      deskMotionProgress: [],
      events: [
        { sequence: 1, eventType: "run_started", atMs: 1_000 },
        { sequence: 2, eventType: "approval_required", atMs: 1_000 },
        { sequence: 3, eventType: "approval_granted", atMs: 1_100 },
        { sequence: 4, eventType: "command_dispatched", atMs: 1_100 },
      ],
      policyDecision: {
        outcome: "require_approval",
        ruleIds: ["desk.motion.requires_approval"],
        reasonCode: null,
      },
    };
    controlPlaneMock.inspectTask.mockResolvedValue(executingRun);
    let emitObservation:
      | ((observation: RuntimeObservation) => void)
      | undefined;
    const unsubscribe = vi.fn();
    controlPlaneMock.subscribeTaskRun.mockImplementation(
      (_runId, onObservation) => {
        emitObservation = onObservation;
        return unsubscribe;
      },
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <OperatorConsole runId="run-reloaded" onRunIdChange={vi.fn()} />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(controlPlaneMock.subscribeTaskRun).toHaveBeenCalledWith(
        "run-reloaded",
        expect.any(Function),
        expect.any(Function),
      ),
    );
    emitObservation?.({
      run: {
        ...executingRun,
        deskMotionProgress: [
          {
            sequence: 1,
            commandId: "command-run-reloaded",
            progressPercent: 50,
            deskHeightMm: 755,
            atMs: 1_500,
          },
        ],
      },
      station: {
        schemaVersion: 1,
        stationId: "station-test",
        stateVersion: 1,
        observedAtMs: 1_500,
        deskHeightMm: 755,
        movementCount: 1,
      },
    });

    await waitFor(() => expect(screen.getByText("Twin 755 mm")).toBeTruthy());
    rendered.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
