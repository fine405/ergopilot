import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const resumed = await client.reconcileTask(awaiting.runId, 1_200);
    const finalSnapshot = await client.stationSnapshot(1_250);

    expect(suspended.status).toBe("suspended");
    expect(suspended.command).toBeNull();
    expect(suspended.commandEvents).toEqual([]);
    expect(afterSuspension.movementCount).toBe(0);
    expect(resumed.runId).toBe(awaiting.runId);
    expect(resumed.status).toBe("completed");
    expect(finalSnapshot.deskHeightMm).toBe(805);
    expect(finalSnapshot.movementCount).toBe(1);
  });
});
