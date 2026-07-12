import type { TaskSpec } from "@ergopilot/contracts";

export interface FocusTaskInput {
  taskId: string;
  requestedBy: string;
  deskHeightMm: number;
  durationMinutes: number;
}

export function buildFocusTask(input: FocusTaskInput): TaskSpec {
  return {
    schemaVersion: 1,
    taskId: input.taskId,
    goal: "prepare_focus_session",
    requestedBy: input.requestedBy,
    constraints: {
      durationMinutes: input.durationMinutes,
      interruptionPolicy: "critical-only",
    },
    assumptions: ["Desk movement area is clear"],
    steps: [
      {
        stepId: "desk-1",
        action: {
          type: "desk.move_to_height",
          input: { heightMm: input.deskHeightMm },
        },
      },
    ],
  };
}
