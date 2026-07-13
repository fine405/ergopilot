import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlannerAttempt } from "@ergopilot/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  createMemoryPlannerAttemptStore,
  openFilePlannerAttemptStore,
} from "./planner-attempt-store";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("planner attempt store", () => {
  it("keeps only the latest 100 attempts in newest-first order", async () => {
    const store = createMemoryPlannerAttemptStore();

    for (let index = 0; index < 105; index += 1) {
      await store.record(attempt(index));
    }

    expect(store.list()).toHaveLength(100);
    expect(store.list()[0]?.traceId).toBe("plan-104");
    expect(store.list()[99]?.traceId).toBe("plan-5");
  });

  it("restores validated attempts after reopening a file store", async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "planner-attempts.json");
    const store = await openFilePlannerAttemptStore(filePath);

    await Promise.all([store.record(attempt(1)), store.record(attempt(2))]);

    const reopened = await openFilePlannerAttemptStore(filePath);
    expect(reopened.list().map(({ traceId }) => traceId)).toEqual([
      "plan-2",
      "plan-1",
    ]);
    const persisted = await readFile(filePath, "utf8");
    expect(persisted).not.toContain("prompt");
    expect(persisted).not.toContain("requestedBy");
  });

  it("rejects a corrupted persistence file instead of discarding evidence", async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "planner-attempts.json");
    await writeFile(filePath, '{"attempts":"corrupted"}');

    await expect(openFilePlannerAttemptStore(filePath)).rejects.toThrow();
  });
});

function attempt(index: number): PlannerAttempt {
  return {
    traceId: `plan-${index}`,
    provider: "deepseek",
    model: "deepseek/deepseek-v4-flash",
    startedAtMs: index,
    durationMs: 5,
    outcome: "succeeded",
    taskId: `task-${index}`,
    errorCode: null,
  };
}

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "ergopilot-attempts-"));
  temporaryDirectories.push(directory);
  return directory;
}
