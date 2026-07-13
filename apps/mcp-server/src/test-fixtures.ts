import type { TaskRunView, TaskSpec } from "@ergopilot/contracts";

export function createAwaitingApprovalRun(task: TaskSpec): TaskRunView {
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
      ruleIds: ["desk.motion.requires_approval"],
      reasonCode: null,
    },
  };
}
