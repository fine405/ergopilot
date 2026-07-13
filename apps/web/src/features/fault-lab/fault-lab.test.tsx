// @vitest-environment jsdom

import {
  defaultWorkstationSnapshotFields,
  type TaskRunView,
} from "@ergopilot/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FaultLab } from "./fault-lab";

const controlPlaneMock = vi.hoisted(() => ({
  startTask: vi.fn(),
  demoApproveTaskWithAckLoss: vi.fn(),
  demoApproveTaskWithDeviceOffline: vi.fn(),
  demoApproveTaskWithActuatorJam: vi.fn(),
  demoApproveTaskWithDeviceUnavailableBeforeDispatch: vi.fn(),
  resumeTask: vi.fn(),
  reconcileTask: vi.fn(),
  stationSnapshot: vi.fn(),
}));

vi.mock("@/lib/control-plane", () => ({ controlPlane: controlPlaneMock }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  controlPlaneMock.stationSnapshot
    .mockResolvedValueOnce(snapshot(720, 0))
    .mockResolvedValueOnce(snapshot(820, 1))
    .mockResolvedValueOnce(snapshot(820, 1));
  controlPlaneMock.startTask.mockResolvedValue(run("awaiting_approval"));
  controlPlaneMock.demoApproveTaskWithAckLoss.mockResolvedValue(
    run("outcome_unknown"),
  );
  controlPlaneMock.reconcileTask.mockResolvedValue(run("completed"));
});

afterEach(cleanup);

describe("FaultLab", () => {
  it("injects ACK loss, displays evidence and reconciles without a duplicate effect", async () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <FaultLab />
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Deterministic fault lab" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Inject ACK loss after effect" }),
    );

    expect(await screen.findByText("outcome_unknown")).toBeTruthy();
    expect(screen.getByText("+1 physical effect")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Reconcile actual state" }),
    );

    expect(await screen.findByText("completed")).toBeTruthy();
    expect(controlPlaneMock.reconcileTask).toHaveBeenCalledWith(
      "run-task-fault-1",
    );
    expect(controlPlaneMock.startTask).toHaveBeenCalledOnce();
    expect(screen.getByText("+1 physical effect")).toBeTruthy();
  });

  it("shows a 60 percent actuator jam and clears it before resuming", async () => {
    controlPlaneMock.stationSnapshot.mockReset();
    controlPlaneMock.stationSnapshot
      .mockResolvedValueOnce(snapshot(720, 0))
      .mockResolvedValueOnce(snapshot(780, 1))
      .mockResolvedValueOnce(snapshot(820, 2));
    const jammed = actuatorFaultRun();
    const failedCommand = jammed.command;
    if (!failedCommand) throw new Error("fixture requires a command");
    const completed = run("completed");
    completed.commandAttempts = [
      {
        stepId: "desk-1",
        command: failedCommand,
        commandEvents: jammed.commandEvents,
        deskMotionProgress: jammed.deskMotionProgress,
      },
    ];
    controlPlaneMock.demoApproveTaskWithActuatorJam.mockResolvedValue(jammed);
    controlPlaneMock.resumeTask.mockResolvedValue(completed);
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <FaultLab />
      </QueryClientProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Inject Actuator jam at 60%" }),
    );

    expect(
      await screen.findByText("recovery reason: actuator_fault"),
    ).toBeTruthy();
    expect(screen.getByText("780 mm")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear fault & resume" }),
    );

    expect(await screen.findByText("completed")).toBeTruthy();
    expect(controlPlaneMock.resumeTask).toHaveBeenCalledWith(
      "run-task-fault-1",
    );
    expect(screen.getAllByText("820 mm")).toHaveLength(2);
    expect(screen.getByText("Retained failed attempt")).toBeTruthy();
    expect(screen.getByText("stopped at 60% · 780 mm")).toBeTruthy();
    expect(screen.getByText("execution_failed")).toBeTruthy();
  });
});

function actuatorFaultRun(): TaskRunView {
  const value = run("suspended", "actuator_fault");
  if (!value.command) throw new Error("fixture requires a command");
  value.command.failureReason = "actuator_fault";
  value.commandEvents = [
    {
      sequence: 3,
      commandId: value.command.commandId,
      eventType: "execution_failed",
      atMs: 1_100,
    },
  ];
  value.deskMotionProgress = [
    {
      sequence: 7,
      commandId: value.command.commandId,
      progressPercent: 60,
      deskHeightMm: 780,
      atMs: 1_100,
    },
  ];
  value.commandAttempts = [
    {
      stepId: "desk-1",
      command: value.command,
      commandEvents: value.commandEvents,
      deskMotionProgress: value.deskMotionProgress,
    },
  ];
  return value;
}

function snapshot(deskHeightMm: number, movementCount: number) {
  return {
    schemaVersion: 1 as const,
    stationId: "station-sim-1",
    stateVersion: movementCount + 1,
    observedAtMs: 1_000,
    deskHeightMm,
    lumbarSupportPercent: 35,
    movementCount,
  };
}

function run(
  status: TaskRunView["status"],
  suspensionReason: TaskRunView["suspensionReason"] = null,
): TaskRunView {
  return {
    runId: "run-task-fault-1",
    taskId: "task-fault-1",
    task: {
      schemaVersion: 1,
      taskId: "task-fault-1",
      goal: "prepare_focus_session",
      requestedBy: "fault-lab-operator",
      constraints: {},
      assumptions: [],
      steps: [
        {
          stepId: "desk-1",
          action: {
            type: "desk.move_to_height",
            input: { heightMm: 820 },
          },
        },
      ],
    },
    status,
    suspensionReason,
    approval: null,
    command:
      status === "awaiting_approval"
        ? null
        : {
            commandId: "command-run-task-fault-1",
            idempotencyKey: "run-task-fault-1:desk-1",
            status:
              status === "completed"
                ? "succeeded"
                : status === "suspended"
                  ? "failed"
                  : "outcome_unknown",
            outcome:
              status === "completed"
                ? {
                    ...defaultWorkstationSnapshotFields,
                    stateVersion: 2,
                    deskHeightMm: 820,
                    lumbarSupportPercent: 35,
                    verifiedAtMs: 1_200,
                  }
                : null,
            wasReplayed: false,
          },
    commandEvents: [],
    deskMotionProgress: [],
    events: [],
    policyDecision: {
      outcome: "require_approval",
      ruleIds: ["desk.motion.requires_approval"],
      reasonCode: null,
    },
  };
}
