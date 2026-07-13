import type { TaskRunView, TaskSpec } from "@ergopilot/contracts";

export function createAwaitingApprovalRun(task: TaskSpec): TaskRunView {
  const firstStep = task.steps[0];
  if (!firstStep) throw new Error("test task must contain one device action");

  return {
    runId: `run-${task.taskId}`,
    taskId: task.taskId,
    task,
    status: "awaiting_approval",
    suspensionReason: null,
    approval: {
      approvalId: `approval-${task.taskId}`,
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
      ruleIds: [
        firstStep.action.type === "desk.move_to_height"
          ? "desk.motion.requires_approval"
          : "chair.lumbar.requires_approval",
      ],
      reasonCode: null,
    },
  };
}
