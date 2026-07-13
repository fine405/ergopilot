// @vitest-environment jsdom

import type { TaskPlanRequest, TaskPlanResponse } from "@ergopilot/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
  reconcileTask: vi.fn(),
  stationSnapshot: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({ useHydrated: () => true }));
vi.mock("@/lib/control-plane", () => ({ controlPlane: controlPlaneMock }));
vi.mock("./agent-planner-card", () => ({
  AgentPlannerCard: ({
    plan,
    isPlanning,
    onGenerate,
  }: {
    plan: TaskPlanResponse | undefined;
    isPlanning: boolean;
    onGenerate: (request: TaskPlanRequest) => Promise<void>;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          void onGenerate({
            provider: "deepseek",
            prompt: "Plan without waiting for trace refresh",
            requestedBy: "test-user",
          })
        }
      >
        Plan now
      </button>
      <span>{isPlanning ? "planning" : (plan?.task.taskId ?? "no plan")}</span>
    </div>
  ),
}));
vi.mock("./planner-attempts-card", () => ({
  PlannerAttemptsCard: () => null,
}));
vi.mock("./run-overview", () => ({ RunOverview: () => null }));
vi.mock("./station-card", () => ({ StationCard: () => null }));
vi.mock("./task-composer", () => ({ TaskComposer: () => null }));

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

    fireEvent.click(screen.getByRole("button", { name: "Plan now" }));

    await waitFor(() =>
      expect(screen.getByText("task-plan-visible")).toBeTruthy(),
    );
    expect(controlPlaneMock.plannerAttempts).toHaveBeenCalledTimes(2);
  });
});
