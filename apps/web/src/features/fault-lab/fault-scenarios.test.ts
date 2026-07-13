import type { TaskRunView, WorkstationSnapshot } from "@ergopilot/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  executeFaultScenario,
  type FaultLabControlPlane,
  recoverFaultScenario,
} from "./fault-scenarios";

describe("fault lab scenarios", () => {
  it("runs ACK loss through the explicit demo path and captures evidence", async () => {
    const before = snapshot({ deskHeightMm: 720, movementCount: 0 });
    const after = snapshot({
      deskHeightMm: 820,
      movementCount: 1,
      stateVersion: 2,
    });
    const pending = run("awaiting_approval");
    const uncertain = run("outcome_unknown");
    const controlPlane = fakeControlPlane();
    controlPlane.stationSnapshot
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    controlPlane.startTask.mockResolvedValue(pending);
    controlPlane.demoApproveTaskWithAckLoss.mockResolvedValue(uncertain);

    const result = await executeFaultScenario(
      controlPlane,
      "ack_loss_after_effect",
    );

    expect(controlPlane.startTask).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: "prepare_focus_session",
        requestedBy: "fault-lab-operator",
        steps: [
          expect.objectContaining({
            action: {
              type: "desk.move_to_height",
              input: { heightMm: 820 },
            },
          }),
        ],
      }),
    );
    expect(controlPlane.demoApproveTaskWithAckLoss).toHaveBeenCalledWith(
      pending.runId,
      "fault-lab-operator",
    );
    expect(result).toEqual({
      scenarioId: "ack_loss_after_effect",
      targetHeightMm: 820,
      before,
      run: uncertain,
      after,
    });
  });

  it("routes device-offline injection without using the ACK-loss path", async () => {
    const controlPlane = fakeControlPlane();
    controlPlane.stationSnapshot.mockResolvedValue(snapshot());
    const pending = run("awaiting_approval");
    const failed = run("failed");
    controlPlane.startTask.mockResolvedValue(pending);
    controlPlane.demoApproveTaskWithDeviceOffline.mockResolvedValue(failed);

    const result = await executeFaultScenario(
      controlPlane,
      "device_offline_before_effect",
    );

    expect(result.run.status).toBe("failed");
    expect(controlPlane.demoApproveTaskWithDeviceOffline).toHaveBeenCalledWith(
      pending.runId,
      "fault-lab-operator",
    );
    expect(controlPlane.demoApproveTaskWithAckLoss).not.toHaveBeenCalled();
  });

  it("resumes a run suspended before dispatch and refreshes recovery evidence", async () => {
    const before = snapshot();
    const recoveredSnapshot = snapshot({
      deskHeightMm: 820,
      movementCount: 1,
      stateVersion: 2,
    });
    const controlPlane = fakeControlPlane();
    controlPlane.stationSnapshot
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(recoveredSnapshot);
    const pending = run("awaiting_approval");
    const suspended = run("suspended");
    const completed = run("completed");
    controlPlane.startTask.mockResolvedValue(pending);
    controlPlane.demoApproveTaskWithDeviceUnavailableBeforeDispatch.mockResolvedValue(
      suspended,
    );
    controlPlane.resumeTask.mockResolvedValue(completed);

    const injected = await executeFaultScenario(
      controlPlane,
      "device_unavailable_before_dispatch",
    );
    const recovered = await recoverFaultScenario(controlPlane, injected);

    expect(
      controlPlane.demoApproveTaskWithDeviceUnavailableBeforeDispatch,
    ).toHaveBeenCalledWith(pending.runId, "fault-lab-operator");
    expect(controlPlane.resumeTask).toHaveBeenCalledWith(suspended.runId);
    expect(controlPlane.reconcileTask).not.toHaveBeenCalled();
    expect(recovered.run.status).toBe("completed");
    expect(recovered.after).toEqual(recoveredSnapshot);
  });

  it("clears an actuator jam and resumes the same run from partial state", async () => {
    const before = snapshot();
    const partial = snapshot({
      deskHeightMm: 780,
      movementCount: 1,
      stateVersion: 2,
    });
    const recoveredSnapshot = snapshot({
      deskHeightMm: 820,
      movementCount: 2,
      stateVersion: 3,
    });
    const controlPlane = fakeControlPlane();
    controlPlane.stationSnapshot
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(partial)
      .mockResolvedValueOnce(recoveredSnapshot);
    const pending = run("awaiting_approval");
    const suspended = actuatorFaultRun();
    const completed = run("completed");
    controlPlane.startTask.mockResolvedValue(pending);
    controlPlane.demoApproveTaskWithActuatorJam.mockResolvedValue(suspended);
    controlPlane.resumeTask.mockResolvedValue(completed);

    const injected = await executeFaultScenario(
      controlPlane,
      "actuator_jam_at_60_percent",
    );
    const recovered = await recoverFaultScenario(controlPlane, injected);

    expect(controlPlane.demoApproveTaskWithActuatorJam).toHaveBeenCalledWith(
      pending.runId,
      "fault-lab-operator",
    );
    expect(injected.after.deskHeightMm).toBe(780);
    expect(controlPlane.resumeTask).toHaveBeenCalledWith(suspended.runId);
    expect(recovered.after.deskHeightMm).toBe(820);
    expect(recovered.after.movementCount).toBe(2);
  });

  it("reconciles an unknown outcome instead of blindly repeating motion", async () => {
    const controlPlane = fakeControlPlane();
    const uncertain = run("outcome_unknown");
    const completed = run("completed");
    const observed = snapshot({ movementCount: 1, deskHeightMm: 820 });
    controlPlane.reconcileTask.mockResolvedValue(completed);
    controlPlane.stationSnapshot.mockResolvedValue(observed);

    const recovered = await recoverFaultScenario(controlPlane, {
      scenarioId: "ack_loss_after_effect",
      targetHeightMm: 820,
      before: snapshot(),
      run: uncertain,
      after: observed,
    });

    expect(controlPlane.reconcileTask).toHaveBeenCalledWith(uncertain.runId);
    expect(controlPlane.resumeTask).not.toHaveBeenCalled();
    expect(controlPlane.startTask).not.toHaveBeenCalled();
    expect(recovered.after.movementCount).toBe(1);
  });
});

function actuatorFaultRun(): TaskRunView {
  const value = run("suspended", "actuator_fault");
  const commandId = "cmd-run-task-fault-1-desk-1";
  return {
    ...value,
    command: {
      commandId,
      idempotencyKey: "run-task-fault-1:desk-1",
      status: "failed",
      outcome: null,
      failureReason: "actuator_fault",
      wasReplayed: true,
    },
    commandEvents: [
      {
        sequence: 3,
        commandId,
        eventType: "execution_failed",
        atMs: 1_100,
      },
    ],
    deskMotionProgress: [
      {
        sequence: 1,
        commandId,
        progressPercent: 60,
        deskHeightMm: 780,
        atMs: 1_100,
      },
    ],
    commandAttempts: [
      {
        stepId: "desk-1",
        command: {
          commandId,
          idempotencyKey: "run-task-fault-1:desk-1",
          status: "failed",
          outcome: null,
          failureReason: "actuator_fault",
          wasReplayed: true,
        },
        commandEvents: [
          {
            sequence: 3,
            commandId,
            eventType: "execution_failed",
            atMs: 1_100,
          },
        ],
        deskMotionProgress: [
          {
            sequence: 1,
            commandId,
            progressPercent: 60,
            deskHeightMm: 780,
            atMs: 1_100,
          },
        ],
      },
    ],
  };
}

function fakeControlPlane() {
  return {
    startTask: vi.fn<FaultLabControlPlane["startTask"]>(),
    demoApproveTaskWithAckLoss:
      vi.fn<FaultLabControlPlane["demoApproveTaskWithAckLoss"]>(),
    demoApproveTaskWithDeviceOffline:
      vi.fn<FaultLabControlPlane["demoApproveTaskWithDeviceOffline"]>(),
    demoApproveTaskWithActuatorJam:
      vi.fn<FaultLabControlPlane["demoApproveTaskWithActuatorJam"]>(),
    demoApproveTaskWithDeviceUnavailableBeforeDispatch:
      vi.fn<
        FaultLabControlPlane["demoApproveTaskWithDeviceUnavailableBeforeDispatch"]
      >(),
    resumeTask: vi.fn<FaultLabControlPlane["resumeTask"]>(),
    reconcileTask: vi.fn<FaultLabControlPlane["reconcileTask"]>(),
    stationSnapshot: vi.fn<FaultLabControlPlane["stationSnapshot"]>(),
  };
}

function snapshot(
  overrides: Partial<WorkstationSnapshot> = {},
): WorkstationSnapshot {
  return {
    schemaVersion: 1,
    stationId: "station-sim-1",
    stateVersion: 1,
    observedAtMs: 1_000,
    deskHeightMm: 720,
    lumbarSupportPercent: 35,
    movementCount: 0,
    ...overrides,
  };
}

function run(
  status: TaskRunView["status"],
  suspensionReason: TaskRunView["suspensionReason"] = status === "suspended"
    ? "device_unavailable"
    : null,
): TaskRunView {
  return {
    runId: "run-task-fault-1",
    taskId: "task-fault-1",
    task: {
      schemaVersion: 1,
      taskId: "task-fault-1",
      goal: "prepare_focus_session",
      requestedBy: "fault-lab-operator",
      constraints: {},
      assumptions: [],
      steps: [
        {
          stepId: "desk-1",
          action: {
            type: "desk.move_to_height",
            input: { heightMm: 820 },
          },
        },
      ],
    },
    status,
    suspensionReason,
    approval: null,
    command: null,
    commandEvents: [],
    deskMotionProgress: [],
    events: [],
    policyDecision: {
      outcome: "require_approval",
      ruleIds: ["desk.motion.requires_approval"],
      reasonCode: null,
    },
  };
}
