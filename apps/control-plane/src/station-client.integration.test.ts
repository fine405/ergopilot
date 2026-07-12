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
});
