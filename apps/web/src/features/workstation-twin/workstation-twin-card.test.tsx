// @vitest-environment jsdom

import type { TaskRunView, WorkstationSnapshot } from "@ergopilot/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkstationTwinCard } from "./workstation-twin-card";

vi.mock("@react-three/fiber", () => ({
  Canvas: () => <div data-testid="workstation-scene" />,
}));

const snapshot: WorkstationSnapshot = {
  schemaVersion: 1,
  stationId: "station-test",
  stateVersion: 3,
  observedAtMs: 1_000,
  deskHeightMm: 720,
  movementCount: 2,
};

const awaitingRun: TaskRunView = {
  runId: "run-awaiting-approval",
  taskId: "task-awaiting-approval",
  task: {
    schemaVersion: 1,
    taskId: "task-awaiting-approval",
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
    approvalId: "approval-1",
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

describe("WorkstationTwinCard", () => {
  it("distinguishes verified height from a pending approval preview", async () => {
    render(
      <WorkstationTwinCard
        snapshot={snapshot}
        run={awaitingRun}
        isLoading={false}
        error={null}
      />,
    );

    expect(screen.getByText("720 mm")).toBeTruthy();
    expect(screen.getByText("Preview 790 mm")).toBeTruthy();
    expect(screen.getByText("Awaiting approval")).toBeTruthy();
    expect(await screen.findByTestId("workstation-scene")).toBeTruthy();
  });
});
