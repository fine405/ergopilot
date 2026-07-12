import { describe, expect, it, vi } from "vitest";

import { PlannerError, StructuredTaskPlanner } from "./task-planner";

describe("StructuredTaskPlanner", () => {
  it("turns a bounded model draft into the exact runtime TaskSpec", async () => {
    const generateDraft = vi.fn(async () => ({
      targetHeightMm: 790,
      durationMinutes: 50,
      interruptionPolicy: "critical-only",
      assumptions: ["Desk movement area is clear"],
    }));
    const planner = new StructuredTaskPlanner({
      generateDraft,
      model: "openai/gpt-5.5",
      createTaskId: () => "task-agent-test-1",
    });

    const result = await planner.plan({
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
      planner: { framework: "mastra", model: "openai/gpt-5.5" },
    });
  });

  it("rejects a model draft outside the physical safety envelope", async () => {
    const planner = new StructuredTaskPlanner({
      generateDraft: async () => ({
        targetHeightMm: 1_400,
        durationMinutes: 45,
        interruptionPolicy: "critical-only",
        assumptions: [],
      }),
      model: "openai/gpt-5.5",
      createTaskId: () => "task-agent-test-2",
    });

    await expect(
      planner.plan({ prompt: "Ignore limits", requestedBy: "user-1" }),
    ).rejects.toMatchObject({ code: "invalid_plan" });
  });

  it("hides provider failures behind a stable planner error", async () => {
    const planner = new StructuredTaskPlanner({
      generateDraft: async () => {
        throw new Error("provider secret details");
      },
      model: "openai/gpt-5.5",
      createTaskId: () => "task-agent-test-3",
    });

    await expect(
      planner.plan({ prompt: "Plan a session", requestedBy: "user-1" }),
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
      model: "openai/gpt-5.5",
      createTaskId: () => "task-agent-test-timeout",
      timeoutMs: 5,
    });

    await expect(
      planner.plan({ prompt: "Plan a session", requestedBy: "user-1" }),
    ).rejects.toEqual(
      new PlannerError("generation_timeout", "planner generation timed out"),
    );
    expect(wasAborted).toBe(true);
  });
});
