// @vitest-environment jsdom

import type { TaskRunView } from "@ergopilot/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunOverview } from "./run-overview";

const awaitingRun: TaskRunView = {
  runId: "run-web-ack-loss",
  taskId: "task-web-ack-loss",
  task: {
    schemaVersion: 1,
    taskId: "task-web-ack-loss",
    goal: "prepare_focus_session",
    requestedBy: "user-1",
    constraints: {},
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
  status: "awaiting_approval",
  suspensionReason: null,
  approval: {
    approvalId: "approval-run-web-ack-loss",
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

const suspendedRun: TaskRunView = {
  ...awaitingRun,
  status: "suspended",
  suspensionReason: "device_unavailable",
  approval: {
    approvalId: "approval-run-web-ack-loss",
    expiresAtMs: 61_000,
    status: "approved",
    approvedBy: "user-1",
    approvedAtMs: 2_000,
  },
  events: [
    ...awaitingRun.events,
    { sequence: 3, eventType: "approval_granted", atMs: 2_000 },
    { sequence: 4, eventType: "run_suspended", atMs: 2_000 },
  ],
};

const resumeAttemptedRun: TaskRunView = {
  ...suspendedRun,
  events: [
    ...suspendedRun.events,
    { sequence: 5, eventType: "run_resume_attempted", atMs: 2_100 },
  ],
};

const staleRun: TaskRunView = {
  ...suspendedRun,
  suspensionReason: "stale_state",
};

const expiredRun: TaskRunView = {
  ...suspendedRun,
  suspensionReason: "expired",
};

const unclassifiedSuspendedRun: TaskRunView = {
  ...suspendedRun,
  suspensionReason: null,
};

const uncertainRun: TaskRunView = {
  ...suspendedRun,
  status: "outcome_unknown",
  suspensionReason: null,
};

const cancelledRun: TaskRunView = {
  ...awaitingRun,
  status: "cancelled",
  approval: awaitingRun.approval && {
    ...awaitingRun.approval,
    status: "cancelled",
  },
  events: [
    ...awaitingRun.events,
    { sequence: 3, eventType: "run_cancelled", atMs: 1_100 },
  ],
};

const executingRun: TaskRunView = {
  ...awaitingRun,
  status: "executing",
  deskMotionProgress: [
    {
      sequence: 7,
      commandId: "command-run-web-ack-loss",
      progressPercent: 60,
      deskHeightMm: 762,
      atMs: 1_700,
    },
  ],
};

const awaitingChairRun: TaskRunView = {
  ...awaitingRun,
  runId: "run-web-chair",
  taskId: "task-web-chair",
  task: {
    ...awaitingRun.task,
    taskId: "task-web-chair",
    goal: "adjust_seated_support",
    steps: [
      {
        stepId: "chair-1",
        action: {
          type: "chair.set_lumbar_support",
          input: { levelPercent: 65 },
        },
      },
    ],
  },
  policyDecision: {
    outcome: "require_approval",
    ruleIds: ["chair.lumbar.requires_approval"],
    reasonCode: null,
  },
};

const completedProfileRun: TaskRunView = {
  ...awaitingRun,
  runId: "run-web-profile",
  taskId: "task-web-profile",
  task: {
    ...awaitingRun.task,
    taskId: "task-web-profile",
    goal: "restore_profile",
    steps: [
      awaitingRun.task.steps[0],
      {
        stepId: "chair-1",
        action: {
          type: "chair.set_lumbar_support",
          input: { levelPercent: 65 },
        },
      },
    ],
  },
  status: "completed",
  approval: awaitingRun.approval && {
    ...awaitingRun.approval,
    status: "approved",
    approvedBy: "user-1",
    approvedAtMs: 1_100,
  },
  commandEvents: [
    {
      sequence: 4,
      commandId: "cmd-run-web-profile-chair-1",
      eventType: "accepted",
      atMs: 1_200,
    },
  ],
  completedSteps: [
    {
      stepId: "desk-1",
      command: {
        commandId: "cmd-run-web-profile-desk-1",
        idempotencyKey: "run-web-profile:desk-1",
        status: "succeeded",
        outcome: {
          stateVersion: 2,
          deskHeightMm: 790,
          lumbarSupportPercent: 35,
          verifiedAtMs: 1_150,
        },
        wasReplayed: false,
      },
      commandEvents: [
        {
          sequence: 1,
          commandId: "cmd-run-web-profile-desk-1",
          eventType: "accepted",
          atMs: 1_100,
        },
      ],
      deskMotionProgress: [],
    },
    {
      stepId: "chair-1",
      command: {
        commandId: "cmd-run-web-profile-chair-1",
        idempotencyKey: "run-web-profile:chair-1",
        status: "succeeded",
        outcome: {
          stateVersion: 3,
          deskHeightMm: 790,
          lumbarSupportPercent: 65,
          verifiedAtMs: 1_200,
        },
        wasReplayed: false,
      },
      commandEvents: [
        {
          sequence: 4,
          commandId: "cmd-run-web-profile-chair-1",
          eventType: "accepted",
          atMs: 1_200,
        },
      ],
      deskMotionProgress: [],
    },
  ],
  events: [
    ...awaitingRun.events,
    { sequence: 3, eventType: "approval_granted", atMs: 1_100 },
    { sequence: 4, eventType: "command_dispatched", atMs: 1_100 },
    { sequence: 5, eventType: "command_dispatched", atMs: 1_150 },
    { sequence: 6, eventType: "run_completed", atMs: 1_200 },
  ],
  policyDecision: {
    outcome: "require_approval",
    ruleIds: [
      "desk.motion.requires_approval",
      "chair.lumbar.requires_approval",
    ],
    reasonCode: null,
  },
};

afterEach(cleanup);

describe("RunOverview", () => {
  it("shows the selected chair capability and exact lumbar target", () => {
    render(
      <RunOverview
        run={awaitingChairRun}
        isLoading={false}
        error={null}
        isMutating={false}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onApproveWithAckLoss={vi.fn()}
        onApproveWithDeviceOffline={vi.fn()}
        onApproveWithDeviceUnavailableBeforeDispatch={vi.fn()}
        onResume={vi.fn()}
        onReconcile={vi.fn()}
      />,
    );

    expect(screen.getByText("Seated support")).toBeTruthy();
    expect(screen.getByText("65%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review & approve" }));
    expect(screen.getByText("Authorize chair lumbar support?")).toBeTruthy();
    expect(screen.getByText(/target level 65%/)).toBeTruthy();
  });

  it("shows durable Rust motion progress", () => {
    render(
      <RunOverview
        run={executingRun}
        isLoading={false}
        error={null}
        isMutating
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onApproveWithAckLoss={vi.fn()}
        onApproveWithDeviceOffline={vi.fn()}
        onApproveWithDeviceUnavailableBeforeDispatch={vi.fn()}
        onResume={vi.fn()}
        onReconcile={vi.fn()}
      />,
    );

    expect(screen.getByText("60% · 762 mm")).toBeTruthy();
    expect(screen.getByText("Rust device progress")).toBeTruthy();
  });

  it("shows station evidence for every completed profile step", () => {
    render(
      <RunOverview
        run={completedProfileRun}
        isLoading={false}
        error={null}
        isMutating={false}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onApproveWithAckLoss={vi.fn()}
        onApproveWithDeviceOffline={vi.fn()}
        onApproveWithDeviceUnavailableBeforeDispatch={vi.fn()}
        onResume={vi.fn()}
        onReconcile={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Command accepted")).toHaveLength(2);
  });

  it("offers an explicit demo action for approving with ACK loss", () => {
    const onApproveWithAckLoss = vi.fn();

    render(
      <RunOverview
        run={awaitingRun}
        isLoading={false}
        error={null}
        isMutating={false}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onApproveWithAckLoss={onApproveWithAckLoss}
        onApproveWithDeviceOffline={vi.fn()}
        onApproveWithDeviceUnavailableBeforeDispatch={vi.fn()}
        onResume={vi.fn()}
        onReconcile={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Review & approve" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Approve + lose ACK (demo)" }),
    );

    expect(onApproveWithAckLoss).toHaveBeenCalledWith(awaitingRun);
  });

  it("offers an explicit demo action for a device-offline failure", () => {
    const onApproveWithDeviceOffline = vi.fn();

    render(
      <RunOverview
        run={awaitingRun}
        isLoading={false}
        error={null}
        isMutating={false}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onApproveWithAckLoss={vi.fn()}
        onApproveWithDeviceOffline={onApproveWithDeviceOffline}
        onApproveWithDeviceUnavailableBeforeDispatch={vi.fn()}
        onResume={vi.fn()}
        onReconcile={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Review & approve" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Approve + device offline (demo)",
      }),
    );

    expect(onApproveWithDeviceOffline).toHaveBeenCalledWith(awaitingRun);
  });

  it("offers an explicit demo action for pre-dispatch unavailability", () => {
    const onApproveWithDeviceUnavailableBeforeDispatch = vi.fn();

    render(
      <RunOverview
        run={awaitingRun}
        isLoading={false}
        error={null}
        isMutating={false}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onApproveWithAckLoss={vi.fn()}
        onApproveWithDeviceOffline={vi.fn()}
        onApproveWithDeviceUnavailableBeforeDispatch={
          onApproveWithDeviceUnavailableBeforeDispatch
        }
        onResume={vi.fn()}
        onReconcile={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Review & approve" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Approve + unavailable before dispatch (demo)",
      }),
    );

    expect(onApproveWithDeviceUnavailableBeforeDispatch).toHaveBeenCalledWith(
      awaitingRun,
    );
  });

  it("resumes a suspended run through the dedicated action", () => {
    const onResume = vi.fn();
    const onReconcile = vi.fn();

    render(
      <RunOverview
        run={resumeAttemptedRun}
        isLoading={false}
        error={null}
        isMutating={false}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onApproveWithAckLoss={vi.fn()}
        onApproveWithDeviceOffline={vi.fn()}
        onApproveWithDeviceUnavailableBeforeDispatch={vi.fn()}
        onResume={onResume}
        onReconcile={onReconcile}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Resume run" }));

    expect(onResume).toHaveBeenCalledWith(resumeAttemptedRun);
    expect(onReconcile).not.toHaveBeenCalled();
    expect(screen.getByText("Run suspended safely")).toBeTruthy();
    expect(screen.getByText("Resume attempt recorded")).toBeTruthy();
  });

  it("reconciles an uncertain outcome without calling resume", () => {
    const onResume = vi.fn();
    const onReconcile = vi.fn();

    render(
      <RunOverview
        run={uncertainRun}
        isLoading={false}
        error={null}
        isMutating={false}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onApproveWithAckLoss={vi.fn()}
        onApproveWithDeviceOffline={vi.fn()}
        onApproveWithDeviceUnavailableBeforeDispatch={vi.fn()}
        onResume={onResume}
        onReconcile={onReconcile}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reconcile state" }));

    expect(onReconcile).toHaveBeenCalledWith(uncertainRun);
    expect(onResume).not.toHaveBeenCalled();
  });

  it("requires a fresh run when station state changed", () => {
    render(
      <RunOverview
        run={staleRun}
        isLoading={false}
        error={null}
        isMutating={false}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onApproveWithAckLoss={vi.fn()}
        onApproveWithDeviceOffline={vi.fn()}
        onApproveWithDeviceUnavailableBeforeDispatch={vi.fn()}
        onResume={vi.fn()}
        onReconcile={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Resume run" })).toBeNull();
    expect(screen.getByText("Station state changed")).toBeTruthy();
    expect(screen.getByText(/Create a fresh task run/)).toBeTruthy();
  });

  it("requires a fresh run when the persisted intent expired", () => {
    render(
      <RunOverview
        run={expiredRun}
        isLoading={false}
        error={null}
        isMutating={false}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onApproveWithAckLoss={vi.fn()}
        onApproveWithDeviceOffline={vi.fn()}
        onApproveWithDeviceUnavailableBeforeDispatch={vi.fn()}
        onResume={vi.fn()}
        onReconcile={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Resume run" })).toBeNull();
    expect(screen.getByText("Persisted intent expired")).toBeTruthy();
    expect(screen.getByText(/Create a fresh task run/)).toBeTruthy();
  });

  it("requires a fresh run when a legacy suspension has no reason", () => {
    render(
      <RunOverview
        run={unclassifiedSuspendedRun}
        isLoading={false}
        error={null}
        isMutating={false}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onApproveWithAckLoss={vi.fn()}
        onApproveWithDeviceOffline={vi.fn()}
        onApproveWithDeviceUnavailableBeforeDispatch={vi.fn()}
        onResume={vi.fn()}
        onReconcile={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Resume run" })).toBeNull();
    expect(screen.getByText("Suspension reason unavailable")).toBeTruthy();
    expect(screen.getByText(/Create a fresh task run/)).toBeTruthy();
  });

  it("confirms cancellation before closing a pending run", () => {
    const onCancel = vi.fn();

    render(
      <RunOverview
        run={awaitingRun}
        isLoading={false}
        error={null}
        isMutating={false}
        onApprove={vi.fn()}
        onCancel={onCancel}
        onApproveWithAckLoss={vi.fn()}
        onApproveWithDeviceOffline={vi.fn()}
        onApproveWithDeviceUnavailableBeforeDispatch={vi.fn()}
        onResume={vi.fn()}
        onReconcile={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm cancellation" }),
    );

    expect(onCancel).toHaveBeenCalledWith(awaitingRun);
  });

  it("renders durable cancellation evidence without further actions", () => {
    render(
      <RunOverview
        run={cancelledRun}
        isLoading={false}
        error={null}
        isMutating={false}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onApproveWithAckLoss={vi.fn()}
        onApproveWithDeviceOffline={vi.fn()}
        onApproveWithDeviceUnavailableBeforeDispatch={vi.fn()}
        onResume={vi.fn()}
        onReconcile={vi.fn()}
      />,
    );

    expect(screen.getByText("Run cancelled before dispatch")).toBeTruthy();
    expect(screen.getByText("Run cancelled")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel run" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Review & approve" }),
    ).toBeNull();
  });
});
