import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  openFilePlannerEvaluationStore,
  PlannerEvaluationStoreError,
} from "./planner-evaluation-store";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("file planner evaluation store", () => {
  it("returns validated reports newest-first without duplicate evidence", async () => {
    const firstDirectory = await temporaryDirectory();
    const secondDirectory = await temporaryDirectory();
    const older = report("2026-07-13T01:00:00.000Z", "smoke");
    const newer = report("2026-07-13T02:00:00.000Z", "full");
    const publishedNewer = {
      ...newer,
      model: "deepseek/deepseek-v4-flash",
      sourceCommit: "67e43cd",
    };
    await Promise.all([
      writeReport(firstDirectory, "older.json", older),
      writeReport(firstDirectory, "newer.json", newer),
      writeReport(secondDirectory, "newer-published.json", publishedNewer),
      writeFile(join(firstDirectory, "notes.txt"), "not evaluation evidence"),
    ]);
    const store = openFilePlannerEvaluationStore([
      firstDirectory,
      secondDirectory,
    ]);

    await expect(store.list()).resolves.toEqual([
      publishedNewer,
      { ...older, model: null, sourceCommit: null },
    ]);
  });

  it("fails closed when a JSON artifact is not valid evaluation evidence", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "broken.json"), '{"schemaVersion":1}');
    const store = openFilePlannerEvaluationStore([directory]);

    await expect(store.list()).rejects.toBeInstanceOf(
      PlannerEvaluationStoreError,
    );
  });
});

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "ergopilot-evals-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeReport(
  directory: string,
  fileName: string,
  value: ReturnType<typeof report>,
) {
  return writeFile(join(directory, fileName), JSON.stringify(value));
}

function report(generatedAt: string, suite: "smoke" | "full") {
  return {
    schemaVersion: 1,
    generatedAt,
    suite,
    provider: "deepseek",
    totalCases: 1,
    passedCases: 1,
    passRate: 1,
    latencyMs: { p50: 100, p95: 100 },
    results: [
      {
        caseId: "standing-critical",
        passed: true,
        failures: [],
        durationMs: 100,
      },
    ],
  } as const;
}
