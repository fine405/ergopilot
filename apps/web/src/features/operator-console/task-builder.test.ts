import { taskSpecSchema } from "@ergopilot/contracts";
import { describe, expect, it } from "vitest";

import { buildFocusTask } from "./task-builder";

describe("buildFocusTask", () => {
  it("builds the exact TaskSpec accepted by the control plane", () => {
    const task = buildFocusTask({
      taskId: "task-browser-1",
      requestedBy: "operator-1",
      deskHeightMm: 790,
      durationMinutes: 50,
    });

    expect(taskSpecSchema.parse(task)).toEqual(task);
    expect(task.steps).toEqual([
      {
        stepId: "desk-1",
        action: {
          type: "desk.move_to_height",
          input: { heightMm: 790 },
        },
      },
    ]);
  });
});
