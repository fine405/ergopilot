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
  approval: {
    approvalId: "approval-run-web-ack-loss",
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

const suspendedRun: TaskRunView = {
  ...awaitingRun,
  status: "suspended",
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

afterEach(cleanup);

describe("RunOverview", () => {
  it("offers an explicit demo action for approving with ACK loss", () => {
    const onApproveWithAckLoss = vi.fn();

    render(
      <RunOverview
        run={awaitingRun}
        isLoading={false}
        error={null}
        isMutating={false}
        onApprove={vi.fn()}
        onApproveWithAckLoss={onApproveWithAckLoss}
        onApproveWithDeviceOffline={vi.fn()}
        onApproveWithDeviceUnavailableBeforeDispatch={vi.fn()}
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
        onApproveWithAckLoss={vi.fn()}
        onApproveWithDeviceOffline={onApproveWithDeviceOffline}
        onApproveWithDeviceUnavailableBeforeDispatch={vi.fn()}
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
        onApproveWithAckLoss={vi.fn()}
        onApproveWithDeviceOffline={vi.fn()}
        onApproveWithDeviceUnavailableBeforeDispatch={
          onApproveWithDeviceUnavailableBeforeDispatch
        }
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

  it("resumes a suspended run through reconciliation", () => {
    const onReconcile = vi.fn();

    render(
      <RunOverview
        run={suspendedRun}
        isLoading={false}
        error={null}
        isMutating={false}
        onApprove={vi.fn()}
        onApproveWithAckLoss={vi.fn()}
        onApproveWithDeviceOffline={vi.fn()}
        onApproveWithDeviceUnavailableBeforeDispatch={vi.fn()}
        onReconcile={onReconcile}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Resume run" }));

    expect(onReconcile).toHaveBeenCalledWith(suspendedRun);
    expect(screen.getByText("Run suspended safely")).toBeTruthy();
  });
});
