import { describe, expect, it } from "vitest";

import { taskRunViewSchema, taskSpecSchema } from "./index";

describe("TaskSpec contract", () => {
  it("matches the versioned planner-to-runtime payload", () => {
    const task = taskSpecSchema.parse({
      schemaVersion: 1,
      taskId: "task-web-1",
      goal: "prepare_focus_session",
      requestedBy: "user-1",
      constraints: { durationMinutes: 45, interruptionPolicy: "critical-only" },
      assumptions: ["desk area is clear"],
      steps: [
        {
          stepId: "desk-1",
          action: {
            type: "desk.move_to_height",
            input: { heightMm: 780 },
          },
        },
      ],
    });

    expect(task.steps[0]?.action.input.heightMm).toBe(780);
  });

  it("rejects an unversioned or empty plan before it reaches Rust", () => {
    expect(() =>
      taskSpecSchema.parse({
        taskId: "task-web-invalid",
        goal: "prepare_focus_session",
        requestedBy: "user-1",
        constraints: {},
        assumptions: [],
        steps: [],
      }),
    ).toThrow();
  });

  it("rejects values that exceed the Rust and process boundaries", () => {
    const valid = {
      schemaVersion: 1,
      taskId: "task-web-bounds",
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

    expect(
      taskSpecSchema.safeParse({
        ...valid,
        constraints: { durationMinutes: 65_536 },
      }).success,
    ).toBe(false);
    expect(
      taskSpecSchema.safeParse({
        ...valid,
        assumptions: Array.from({ length: 17 }, () => "bounded"),
      }).success,
    ).toBe(false);
  });
});

describe("TaskRunView contract", () => {
  it("parses the approval state returned by the Rust runtime", () => {
    const run = taskRunViewSchema.parse({
      runId: "run-task-web-1",
      taskId: "task-web-1",
      task: {
        schemaVersion: 1,
        taskId: "task-web-1",
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
      approval: {
        approvalId: "approval-run-task-web-1",
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
    });

    expect(run.approval?.status).toBe("pending");
  });
});
