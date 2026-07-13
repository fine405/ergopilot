import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { TaskSpec } from "@ergopilot/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { ProcessStationClient } from "./station-client";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ProcessStationClient", () => {
  it("rejects simulator timing that can exceed the RPC deadline", () => {
    expect(
      () =>
        new ProcessStationClient({
          binaryPath: "station-cli",
          databasePath: "station.sqlite",
          policyKey: "ergopilot-test-policy-key",
          motionStepMs: 500,
        }),
    ).toThrow("motionStepMs must be between 0 and 400");
    expect(
      () =>
        new ProcessStationClient({
          binaryPath: "station-cli",
          databasePath: "station.sqlite",
          policyKey: "ergopilot-test-policy-key",
          motionStepMs: 100,
          timeoutMs: 1_500,
        }),
    ).toThrow("timeoutMs must exceed the simulated motion duration by 500 ms");
  });

  it("returns a stable code when a task run does not exist", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ergopilot-missing-run-"));
    temporaryDirectories.push(directory);
    const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
    const client = new ProcessStationClient({
      binaryPath: `${workspaceRoot}/target/debug/station-cli`,
      databasePath: `${directory}/station.sqlite`,
      policyKey: "ergopilot-test-policy-key",
    });

    await expect(client.inspectTask("run-missing")).rejects.toMatchObject({
      code: "run_not_found",
    });
  });

  it("preserves stable semantic error codes across the process boundary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ergopilot-forbidden-"));
    temporaryDirectories.push(directory);
    const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
    const client = new ProcessStationClient({
      binaryPath: `${workspaceRoot}/target/debug/station-cli`,
      databasePath: `${directory}/station.sqlite`,
      policyKey: "ergopilot-test-policy-key",
    });
    const task: TaskSpec = {
      schemaVersion: 1,
      taskId: "task-process-client-forbidden",
      goal: "prepare_focus_session",
      requestedBy: "user-1",
      constraints: {},
      assumptions: [],
      steps: [
        {
          stepId: "desk-1",
          action: {
            type: "desk.move_to_height",
            input: { heightMm: 790 },
          },
        },
      ],
    };

    await expect(
      client.startTask(
        { ...task, taskId: "task-process-client-invalid", steps: [] },
        900,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });

    const awaiting = await client.startTask(task, 1_000);

    await expect(
      client.approveTask(awaiting.runId, "user-2", 1_100),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      client.cancelTask(awaiting.runId, "user-2", 1_100),
    ).rejects.toMatchObject({ code: "forbidden" });

    await expect(
      client.startTask(
        {
          ...task,
          steps: [
            {
              stepId: "desk-1",
              action: {
                type: "desk.move_to_height",
                input: { heightMm: 800 },
              },
            },
          ],
        },
        1_200,
      ),
    ).rejects.toMatchObject({ code: "task_conflict" });

    await expect(
      client.approveTask(awaiting.runId, "user-1", 61_000),
    ).rejects.toMatchObject({ code: "approval_expired" });

    const cancellable = await client.startTask(
      { ...task, taskId: "task-process-client-cancel" },
      1_300,
    );
    const cancelled = await client.cancelTask(
      cancellable.runId,
      "user-1",
      1_400,
    );
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.events.at(-1)?.eventType).toBe("run_cancelled");
  });

  it("runs the browser control path against the real Rust runtime", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ergopilot-control-plane-"));
    temporaryDirectories.push(directory);
    const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
    const client = new ProcessStationClient({
      binaryPath: `${workspaceRoot}/target/debug/station-cli`,
      databasePath: `${directory}/station.sqlite`,
      policyKey: "ergopilot-test-policy-key",
    });
    const task: TaskSpec = {
      schemaVersion: 1,
      taskId: "task-process-client-1",
      goal: "prepare_focus_session",
      requestedBy: "user-1",
      constraints: {},
      assumptions: [],
      steps: [
        {
          stepId: "desk-1",
          action: {
            type: "desk.move_to_height",
            input: { heightMm: 790 },
          },
        },
      ],
    };

    const awaiting = await client.startTask(task, 1_000);
    const inspected = await client.inspectTask(awaiting.runId);
    const completed = await client.approveTask(awaiting.runId, "user-1", 1_100);
    const snapshot = await client.stationSnapshot(1_200);

    expect(inspected.status).toBe("awaiting_approval");
    expect(completed.status).toBe("completed");
    expect(snapshot.deskHeightMm).toBe(790);
    expect(snapshot.movementCount).toBe(1);
  });

  it("runs a protected chair action across the TypeScript-Rust boundary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ergopilot-chair-"));
    temporaryDirectories.push(directory);
    const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
    const client = new ProcessStationClient({
      binaryPath: `${workspaceRoot}/target/debug/station-cli`,
      databasePath: `${directory}/station.sqlite`,
      policyKey: "ergopilot-test-policy-key",
    });
    const task: TaskSpec = {
      schemaVersion: 1,
      taskId: "task-process-chair-1",
      goal: "adjust_seated_support",
      requestedBy: "user-1",
      constraints: {},
      assumptions: [],
      steps: [
        {
          stepId: "chair-1",
          action: {
            type: "chair.set_lumbar_support",
            input: { levelPercent: 65 },
          },
        },
      ],
    };

    const before = await client.stationSnapshot(900);
    const awaiting = await client.startTask(task, 1_000);
    const completed = await client.approveTask(awaiting.runId, "user-1", 1_100);
    const after = await client.stationSnapshot(1_200);

    expect(before.lumbarSupportPercent).toBe(35);
    expect(awaiting.status).toBe("awaiting_approval");
    expect(completed.status).toBe("completed");
    expect(completed.deskMotionProgress).toEqual([]);
    expect(completed.command?.outcome?.lumbarSupportPercent).toBe(65);
    expect(after.lumbarSupportPercent).toBe(65);
    expect(after.deskHeightMm).toBe(720);
    expect(after.movementCount).toBe(1);
  });

  it("executes one approved workstation profile across the process boundary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ergopilot-profile-"));
    temporaryDirectories.push(directory);
    const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
    const client = new ProcessStationClient({
      binaryPath: `${workspaceRoot}/target/debug/station-cli`,
      databasePath: `${directory}/station.sqlite`,
      policyKey: "ergopilot-test-policy-key",
    });
    const task: TaskSpec = {
      schemaVersion: 1,
      taskId: "task-process-profile-1",
      goal: "restore_profile",
      requestedBy: "user-1",
      constraints: {},
      assumptions: ["Desk movement area is clear"],
      steps: [
        {
          stepId: "desk-1",
          action: {
            type: "desk.move_to_height",
            input: { heightMm: 780 },
          },
        },
        {
          stepId: "chair-1",
          action: {
            type: "chair.set_lumbar_support",
            input: { levelPercent: 65 },
          },
        },
      ],
    };

    const awaiting = await client.startTask(task, 1_000);
    const completed = await client.approveTask(awaiting.runId, "user-1", 1_100);
    const after = await client.stationSnapshot(1_200);

    expect(awaiting.status).toBe("awaiting_approval");
    expect(completed.status).toBe("completed");
    expect(completed.completedSteps?.map((step) => step.stepId)).toEqual([
      "desk-1",
      "chair-1",
    ]);
    expect(after.deskHeightMm).toBe(780);
    expect(after.lumbarSupportPercent).toBe(65);
    expect(after.movementCount).toBe(2);
  });

  it("recovers a killed partial motion and permits the next command", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "ergopilot-partial-motion-"),
    );
    temporaryDirectories.push(directory);
    const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
    const binaryPath = `${workspaceRoot}/target/debug/station-cli`;
    const databasePath = `${directory}/station.sqlite`;
    const policyKey = "ergopilot-test-policy-key";
    const client = new ProcessStationClient({
      binaryPath,
      databasePath,
      policyKey,
    });
    const task: TaskSpec = {
      schemaVersion: 1,
      taskId: "task-process-client-partial-motion",
      goal: "prepare_focus_session",
      requestedBy: "user-1",
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
    };
    const awaiting = await client.startTask(task, 1_000);
    const approvalProcess = spawn(binaryPath, ["--rpc", databasePath], {
      env: {
        ...process.env,
        ERGOPILOT_POLICY_KEY: policyKey,
        ERGOPILOT_SIM_MOTION_STEP_MS: "100",
      },
      stdio: ["pipe", "ignore", "ignore"],
    });
    const processClosed = once(approvalProcess, "close");
    approvalProcess.stdin.end(
      JSON.stringify({
        method: "task.approve",
        params: {
          runId: awaiting.runId,
          approvedBy: "user-1",
          nowMs: 1_100,
        },
      }),
    );

    let interruptedProgress = 0;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await delay(40);
      const current = await client.inspectTask(awaiting.runId);
      interruptedProgress =
        current.deskMotionProgress.at(-1)?.progressPercent ?? 0;
      if (interruptedProgress >= 20 && interruptedProgress < 100) {
        approvalProcess.kill("SIGKILL");
        break;
      }
    }
    await processClosed;

    expect(interruptedProgress).toBeGreaterThanOrEqual(20);
    expect(interruptedProgress).toBeLessThan(100);
    const reconciled = await client.reconcileTask(awaiting.runId, 1_500);
    expect(reconciled.status).toBe("outcome_unknown");

    const recoveryAwaiting = await client.startTask(
      { ...task, taskId: "task-process-client-after-partial-motion" },
      1_600,
    );
    const recovered = await client.approveTask(
      recoveryAwaiting.runId,
      "user-1",
      1_700,
    );
    const snapshot = await client.stationSnapshot(1_800);

    expect(recovered.status).toBe("completed");
    expect(snapshot.deskHeightMm).toBe(820);
    expect(snapshot.movementCount).toBe(2);
  });

  it("injects ACK loss and reconciles the real Rust runtime once", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ergopilot-ack-loss-"));
    temporaryDirectories.push(directory);
    const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
    const client = new ProcessStationClient({
      binaryPath: `${workspaceRoot}/target/debug/station-cli`,
      databasePath: `${directory}/station.sqlite`,
      policyKey: "ergopilot-test-policy-key",
    });
    const task: TaskSpec = {
      schemaVersion: 1,
      taskId: "task-process-client-ack-loss",
      goal: "prepare_focus_session",
      requestedBy: "user-1",
      constraints: {},
      assumptions: [],
      steps: [
        {
          stepId: "desk-1",
          action: {
            type: "desk.move_to_height",
            input: { heightMm: 800 },
          },
        },
      ],
    };

    const awaiting = await client.startTask(task, 1_000);
    const uncertain = await client.demoApproveTaskWithAckLoss(
      awaiting.runId,
      "user-1",
      1_100,
    );
    const afterEffect = await client.stationSnapshot(1_150);
    const reconciled = await client.reconcileTask(awaiting.runId, 1_200);
    const finalSnapshot = await client.stationSnapshot(1_250);

    expect(uncertain.status).toBe("outcome_unknown");
    expect(afterEffect.deskHeightMm).toBe(800);
    expect(afterEffect.movementCount).toBe(1);
    expect(reconciled.status).toBe("completed");
    expect(finalSnapshot.movementCount).toBe(1);
  });

  it("fails offline motion before effect and completes a fresh run once", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ergopilot-offline-"));
    temporaryDirectories.push(directory);
    const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
    const client = new ProcessStationClient({
      binaryPath: `${workspaceRoot}/target/debug/station-cli`,
      databasePath: `${directory}/station.sqlite`,
      policyKey: "ergopilot-test-policy-key",
    });
    const task: TaskSpec = {
      schemaVersion: 1,
      taskId: "task-process-client-offline",
      goal: "prepare_focus_session",
      requestedBy: "user-1",
      constraints: {},
      assumptions: [],
      steps: [
        {
          stepId: "desk-1",
          action: {
            type: "desk.move_to_height",
            input: { heightMm: 810 },
          },
        },
      ],
    };

    const awaiting = await client.startTask(task, 1_000);
    const failed = await client.demoApproveTaskWithDeviceOffline(
      awaiting.runId,
      "user-1",
      1_100,
    );
    const afterFailure = await client.stationSnapshot(1_150);
    const recoveryTask = {
      ...task,
      taskId: "task-process-client-after-offline",
    };
    const recoveryAwaiting = await client.startTask(recoveryTask, 1_200);
    const completed = await client.approveTask(
      recoveryAwaiting.runId,
      "user-1",
      1_300,
    );
    const finalSnapshot = await client.stationSnapshot(1_350);

    expect(failed.status).toBe("failed");
    expect(failed.commandEvents.at(-1)?.eventType).toBe("execution_failed");
    expect(afterFailure.deskHeightMm).toBe(720);
    expect(afterFailure.movementCount).toBe(0);
    expect(completed.status).toBe("completed");
    expect(finalSnapshot.deskHeightMm).toBe(810);
    expect(finalSnapshot.movementCount).toBe(1);
  });

  it("suspends pre-dispatch unavailability and resumes the same run", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ergopilot-suspended-"));
    temporaryDirectories.push(directory);
    const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
    const client = new ProcessStationClient({
      binaryPath: `${workspaceRoot}/target/debug/station-cli`,
      databasePath: `${directory}/station.sqlite`,
      policyKey: "ergopilot-test-policy-key",
    });
    const task: TaskSpec = {
      schemaVersion: 1,
      taskId: "task-process-client-suspended",
      goal: "prepare_focus_session",
      requestedBy: "user-1",
      constraints: {},
      assumptions: [],
      steps: [
        {
          stepId: "desk-1",
          action: {
            type: "desk.move_to_height",
            input: { heightMm: 805 },
          },
        },
      ],
    };

    const awaiting = await client.startTask(task, 1_000);
    const suspended =
      await client.demoApproveTaskWithDeviceUnavailableBeforeDispatch(
        awaiting.runId,
        "user-1",
        1_100,
      );
    const afterSuspension = await client.stationSnapshot(1_150);
    await expect(
      client.reconcileTask(awaiting.runId, 1_175),
    ).rejects.toMatchObject({ code: "invalid_transition" });
    const resumed = await client.resumeTask(
      awaiting.runId,
      "operator-42",
      1_200,
    );
    const finalSnapshot = await client.stationSnapshot(1_250);

    expect(suspended.status).toBe("suspended");
    expect(suspended.suspensionReason).toBe("device_unavailable");
    expect(suspended.command).toBeNull();
    expect(suspended.commandEvents).toEqual([]);
    expect(afterSuspension.movementCount).toBe(0);
    expect(resumed.runId).toBe(awaiting.runId);
    expect(resumed.status).toBe("completed");
    expect(resumed.suspensionReason).toBeNull();
    expect(resumed.events.at(-1)?.eventType).toBe("run_resumed");
    expect(finalSnapshot.deskHeightMm).toBe(805);
    expect(finalSnapshot.movementCount).toBe(1);
  });

  it("resumes an actuator jam from its observed 60 percent position", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ergopilot-actuator-jam-"));
    temporaryDirectories.push(directory);
    const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
    const client = new ProcessStationClient({
      binaryPath: `${workspaceRoot}/target/debug/station-cli`,
      databasePath: `${directory}/station.sqlite`,
      policyKey: "ergopilot-test-policy-key",
    });
    const task: TaskSpec = {
      schemaVersion: 1,
      taskId: "task-process-client-actuator-jam",
      goal: "prepare_focus_session",
      requestedBy: "user-1",
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
    };

    const awaiting = await client.startTask(task, 1_000);
    const suspended = await client.demoApproveTaskWithActuatorJam(
      awaiting.runId,
      "user-1",
      1_100,
    );
    const partial = await client.stationSnapshot(1_150);
    const completed = await client.resumeTask(
      awaiting.runId,
      "operator-42",
      1_200,
    );
    const finalSnapshot = await client.stationSnapshot(1_250);

    expect(suspended.status).toBe("suspended");
    expect(suspended.suspensionReason).toBe("actuator_fault");
    expect(suspended.deskMotionProgress.at(-1)?.progressPercent).toBe(60);
    expect(partial.deskHeightMm).toBe(780);
    expect(partial.movementCount).toBe(1);
    expect(completed.status).toBe("completed");
    expect(completed.events.at(-1)?.eventType).toBe("run_resumed");
    expect(completed.commandAttempts).toHaveLength(1);
    expect(completed.commandAttempts?.[0]?.command.status).toBe("failed");
    expect(completed.commandAttempts?.[0]?.command.failureReason).toBe(
      "actuator_fault",
    );
    expect(
      completed.commandAttempts?.[0]?.deskMotionProgress.at(-1)
        ?.progressPercent,
    ).toBe(60);
    expect(completed.commandAttempts?.[0]?.command.commandId).not.toContain(
      "recovery",
    );
    expect(finalSnapshot.deskHeightMm).toBe(820);
    expect(finalSnapshot.movementCount).toBe(2);
  });
});
