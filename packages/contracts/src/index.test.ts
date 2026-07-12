import { describe, expect, it } from "vitest";

import {
  plannerAttemptsResponseSchema,
  plannerProvidersResponseSchema,
  taskPlanDraftSchema,
  taskPlanRequestSchema,
  taskPlanResponseSchema,
  taskRunViewSchema,
  taskSpecSchema,
} from "./index";

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

describe("Task planning contract", () => {
  it("accepts privacy-safe planner attempt evidence", () => {
    expect(
      plannerAttemptsResponseSchema.parse({
        attempts: [
          {
            traceId: "plan-trace-1",
            provider: "deepseek",
            model: "deepseek/deepseek-v4-flash",
            startedAtMs: 1_000,
            durationMs: 25,
            outcome: "succeeded",
            taskId: "task-agent-1",
            errorCode: null,
          },
        ],
      }).attempts[0],
    ).toEqual({
      traceId: "plan-trace-1",
      provider: "deepseek",
      model: "deepseek/deepseek-v4-flash",
      startedAtMs: 1_000,
      durationMs: 25,
      outcome: "succeeded",
      taskId: "task-agent-1",
      errorCode: null,
    });
  });

  it("rejects contradictory planner attempt evidence", () => {
    expect(
      plannerAttemptsResponseSchema.safeParse({
        attempts: [
          {
            traceId: "plan-trace-invalid",
            provider: "deepseek",
            model: "deepseek/deepseek-v4-flash",
            startedAtMs: 1_000,
            durationMs: 25,
            outcome: "succeeded",
            taskId: null,
            errorCode: "invalid_plan",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("describes configured and disabled planner providers", () => {
    expect(
      plannerProvidersResponseSchema.parse({
        providers: [
          {
            id: "openai",
            name: "OpenAI",
            model: "openai/gpt-5.5",
            enabled: false,
          },
          {
            id: "deepseek",
            name: "DeepSeek",
            model: "deepseek/deepseek-v4-flash",
            enabled: true,
          },
        ],
      }),
    ).toEqual({
      providers: [
        {
          id: "openai",
          name: "OpenAI",
          model: "openai/gpt-5.5",
          enabled: false,
        },
        {
          id: "deepseek",
          name: "DeepSeek",
          model: "deepseek/deepseek-v4-flash",
          enabled: true,
        },
      ],
    });
  });

  it("accepts a bounded natural-language request and generated plan", () => {
    expect(
      taskPlanRequestSchema.parse({
        provider: "deepseek",
        prompt: "Raise the desk for a 45 minute focus session",
        requestedBy: "user-1",
      }),
    ).toEqual({
      provider: "deepseek",
      prompt: "Raise the desk for a 45 minute focus session",
      requestedBy: "user-1",
    });
    expect(
      taskPlanDraftSchema.parse({
        targetHeightMm: 780,
        durationMinutes: 45,
        interruptionPolicy: "critical-only",
        assumptions: ["Desk movement area is clear"],
      }).targetHeightMm,
    ).toBe(780);
  });

  it("rejects oversized prompts and unsafe generated desk heights", () => {
    expect(
      taskPlanRequestSchema.safeParse({
        prompt: "x".repeat(2_001),
        requestedBy: "user-1",
      }).success,
    ).toBe(false);
    expect(
      taskPlanDraftSchema.safeParse({
        targetHeightMm: 1_400,
        durationMinutes: 45,
        interruptionPolicy: "critical-only",
        assumptions: [],
      }).success,
    ).toBe(false);
  });

  it("requires planner provenance on the final TaskSpec", () => {
    const response = taskPlanResponseSchema.parse({
      task: {
        schemaVersion: 1,
        taskId: "task-agent-1",
        goal: "prepare_focus_session",
        requestedBy: "user-1",
        constraints: {
          durationMinutes: 45,
          interruptionPolicy: "critical-only",
        },
        assumptions: ["Desk movement area is clear"],
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
      planner: {
        framework: "mastra",
        provider: "openai",
        model: "openai/gpt-5.5",
      },
    });

    expect(response.planner.provider).toBe("openai");
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
