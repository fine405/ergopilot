import type {
  TaskRunView,
  TaskSpec,
  WorkstationSnapshot,
} from "@ergopilot/contracts";

import type { ControlPlane } from "@/lib/control-plane";

export type FaultScenarioId =
  | "ack_loss_after_effect"
  | "device_offline_before_effect"
  | "device_unavailable_before_dispatch";

export type FaultLabControlPlane = Pick<
  ControlPlane,
  | "startTask"
  | "demoApproveTaskWithAckLoss"
  | "demoApproveTaskWithDeviceOffline"
  | "demoApproveTaskWithDeviceUnavailableBeforeDispatch"
  | "resumeTask"
  | "reconcileTask"
  | "stationSnapshot"
>;

export interface FaultScenarioResult {
  scenarioId: FaultScenarioId;
  targetHeightMm: number;
  before: WorkstationSnapshot;
  run: TaskRunView;
  after: WorkstationSnapshot;
}

const faultLabOperator = "fault-lab-operator";

export async function executeFaultScenario(
  controlPlane: FaultLabControlPlane,
  scenarioId: FaultScenarioId,
): Promise<FaultScenarioResult> {
  const before = await controlPlane.stationSnapshot();
  const targetHeightMm = before.deskHeightMm < 790 ? 820 : 760;
  const task: TaskSpec = {
    schemaVersion: 1,
    taskId: `task-fault-${crypto.randomUUID()}`,
    goal: "prepare_focus_session",
    requestedBy: faultLabOperator,
    constraints: { durationMinutes: 15, interruptionPolicy: "normal" },
    assumptions: ["Operator requested a simulation-only fault injection"],
    steps: [
      {
        stepId: "desk-1",
        action: {
          type: "desk.move_to_height",
          input: { heightMm: targetHeightMm },
        },
      },
    ],
  };
  const pending = await controlPlane.startTask(task);
  const run = await approveWithFault(controlPlane, scenarioId, pending.runId);
  const after = await controlPlane.stationSnapshot();
  return { scenarioId, targetHeightMm, before, run, after };
}

export async function recoverFaultScenario(
  controlPlane: FaultLabControlPlane,
  result: FaultScenarioResult,
): Promise<FaultScenarioResult> {
  const run =
    result.run.status === "outcome_unknown"
      ? await controlPlane.reconcileTask(result.run.runId)
      : result.run.status === "suspended" &&
          result.run.suspensionReason === "device_unavailable"
        ? await controlPlane.resumeTask(result.run.runId)
        : null;
  if (!run) throw new Error("fault scenario does not require recovery");
  return { ...result, run, after: await controlPlane.stationSnapshot() };
}

function approveWithFault(
  controlPlane: FaultLabControlPlane,
  scenarioId: FaultScenarioId,
  runId: string,
) {
  switch (scenarioId) {
    case "ack_loss_after_effect":
      return controlPlane.demoApproveTaskWithAckLoss(runId, faultLabOperator);
    case "device_offline_before_effect":
      return controlPlane.demoApproveTaskWithDeviceOffline(
        runId,
        faultLabOperator,
      );
    case "device_unavailable_before_dispatch":
      return controlPlane.demoApproveTaskWithDeviceUnavailableBeforeDispatch(
        runId,
        faultLabOperator,
      );
  }
}
