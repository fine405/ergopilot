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

const executingRun: TaskRunView = {
  ...awaitingRun,
  status: "executing",
  approval: awaitingRun.approval && {
    ...awaitingRun.approval,
    status: "approved",
    approvedBy: "user-1",
    approvedAtMs: 1_100,
  },
  deskMotionProgress: [
    {
      sequence: 5,
      commandId: "command-run-awaiting-approval",
      progressPercent: 40,
      deskHeightMm: 748,
      atMs: 1_500,
    },
  ],
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
    expect(screen.getByText("RAPIER PHYSICS")).toBeTruthy();
    expect(screen.getByText("Kinematic actuator")).toBeTruthy();
    expect(screen.getByText("Gravity + collisions")).toBeTruthy();
    expect(await screen.findByTestId("workstation-scene")).toBeTruthy();
  });

  it("renders Rust-observed motion instead of an approval preview", () => {
    render(
      <WorkstationTwinCard
        snapshot={{ ...snapshot, deskHeightMm: 748 }}
        run={executingRun}
        isLoading={false}
        error={null}
      />,
    );

    expect(screen.getByText("Observed desk height")).toBeTruthy();
    expect(screen.getByText("40% · 748 mm")).toBeTruthy();
    expect(
      screen
        .getByRole("progressbar", { name: "Desk motion progress" })
        .getAttribute("aria-valuenow"),
    ).toBe("40");
    expect(screen.queryByText("Preview 790 mm")).toBeNull();
  });
});
