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
});
