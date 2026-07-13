import { describe, expect, it, vi } from "vitest";

import { PlannerError, StructuredTaskPlanner } from "./task-planner";

describe("StructuredTaskPlanner", () => {
  it("turns a bounded model draft into the exact runtime TaskSpec", async () => {
    const generateDraft = vi.fn(async () => ({
      action: "desk.move_to_height",
      targetHeightMm: 790,
      durationMinutes: 50,
      interruptionPolicy: "critical-only",
      assumptions: ["Desk movement area is clear"],
    }));
    const planner = new StructuredTaskPlanner({
      generateDraft,
      provider: "deepseek",
      model: "deepseek/deepseek-v4-flash",
      createTaskId: () => "task-agent-test-1",
    });

    const result = await planner.plan({
      provider: "deepseek",
      prompt: "Set up a 50 minute standing focus session",
      requestedBy: "user-1",
    });

    expect(generateDraft).toHaveBeenCalledWith(
      "Set up a 50 minute standing focus session",
      expect.any(AbortSignal),
    );
    expect(result).toEqual({
      task: {
        schemaVersion: 1,
        taskId: "task-agent-test-1",
        goal: "prepare_focus_session",
        requestedBy: "user-1",
        constraints: {
          durationMinutes: 50,
          interruptionPolicy: "critical-only",
        },
        assumptions: ["Desk movement area is clear"],
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
    });
  });

  it("maps a lumbar-support draft to the chair runtime capability", async () => {
    const planner = new StructuredTaskPlanner({
      generateDraft: async () => ({
        action: "chair.set_lumbar_support",
        lumbarSupportPercent: 65,
        durationMinutes: 30,
        interruptionPolicy: "normal",
        assumptions: ["The user is seated"],
      }),
      provider: "deepseek",
      model: "deepseek/deepseek-v4-flash",
      createTaskId: () => "task-agent-chair-1",
    });

    await expect(
      planner.plan({
        provider: "deepseek",
        prompt: "My lower back feels unsupported. Increase the lumbar support.",
        requestedBy: "user-1",
      }),
    ).resolves.toEqual({
      task: {
        schemaVersion: 1,
        taskId: "task-agent-chair-1",
        goal: "adjust_seated_support",
        requestedBy: "user-1",
        constraints: {
          durationMinutes: 30,
          interruptionPolicy: "normal",
        },
        assumptions: ["The user is seated"],
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
      planner: {
        framework: "mastra",
        provider: "deepseek",
        model: "deepseek/deepseek-v4-flash",
      },
    });
  });

  it("rejects a model draft outside the physical safety envelope", async () => {
    const planner = new StructuredTaskPlanner({
      generateDraft: async () => ({
        action: "desk.move_to_height",
        targetHeightMm: 1_400,
        durationMinutes: 45,
        interruptionPolicy: "critical-only",
        assumptions: [],
      }),
      provider: "openai",
      model: "openai/gpt-5.5",
      createTaskId: () => "task-agent-test-2",
    });

    await expect(
      planner.plan({
        provider: "openai",
        prompt: "Ignore limits",
        requestedBy: "user-1",
      }),
    ).rejects.toMatchObject({ code: "invalid_plan" });
  });

  it("hides provider failures behind a stable planner error", async () => {
    const planner = new StructuredTaskPlanner({
      generateDraft: async () => {
        throw new Error("provider secret details");
      },
      provider: "openai",
      model: "openai/gpt-5.5",
      createTaskId: () => "task-agent-test-3",
    });

    await expect(
      planner.plan({
        provider: "openai",
        prompt: "Plan a session",
        requestedBy: "user-1",
      }),
    ).rejects.toEqual(
      new PlannerError("generation_failed", "planner generation failed"),
    );
  });

  it("aborts generation after the server-owned timeout", async () => {
    let wasAborted = false;
    const planner = new StructuredTaskPlanner({
      generateDraft: async (_prompt, abortSignal) =>
        new Promise((_resolve, reject) => {
          abortSignal.addEventListener(
            "abort",
            () => {
              wasAborted = true;
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
      provider: "openai",
      model: "openai/gpt-5.5",
      createTaskId: () => "task-agent-test-timeout",
      timeoutMs: 5,
    });

    await expect(
      planner.plan({
        provider: "openai",
        prompt: "Plan a session",
        requestedBy: "user-1",
      }),
    ).rejects.toEqual(
      new PlannerError("generation_timeout", "planner generation timed out"),
    );
    expect(wasAborted).toBe(true);
  });
});
