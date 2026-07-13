import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type PlannerEvaluationReport,
  plannerEvaluationReportSchema,
} from "@ergopilot/contracts";

export interface PlannerEvaluationStore {
  list(): Promise<PlannerEvaluationReport[]>;
}

export class PlannerEvaluationStoreError extends Error {
  constructor(options?: ErrorOptions) {
    super("planner evaluation evidence could not be loaded", options);
    this.name = "PlannerEvaluationStoreError";
  }
}

export function openFilePlannerEvaluationStore(
  directories: readonly string[],
): PlannerEvaluationStore {
  return {
    async list() {
      try {
        const reports = new Map<string, PlannerEvaluationReport>();
        for (const directory of directories) {
          for (const fileName of await evaluationFiles(directory)) {
            const value: unknown = JSON.parse(
              await readFile(join(directory, fileName), "utf8"),
            );
            const report = plannerEvaluationReportSchema.parse(
              normalizeOptionalProvenance(value),
            );
            const key = `${report.provider}:${report.suite}:${report.generatedAt}`;
            const existing = reports.get(key);
            if (existing) {
              if (coreEvidence(existing) !== coreEvidence(report)) {
                throw new Error(`conflicting evaluation evidence for ${key}`);
              }
              if (provenanceFields(report) > provenanceFields(existing)) {
                reports.set(key, report);
              }
            } else {
              reports.set(key, report);
            }
          }
        }
        return [...reports.values()].sort((left, right) =>
          right.generatedAt.localeCompare(left.generatedAt),
        );
      } catch (error) {
        throw new PlannerEvaluationStoreError({ cause: error });
      }
    },
  };
}

async function evaluationFiles(directory: string) {
  try {
    return (await readdir(directory))
      .filter((fileName) => fileName.endsWith(".json"))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function normalizeOptionalProvenance(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  return { model: null, sourceCommit: null, ...value };
}

function coreEvidence(report: PlannerEvaluationReport) {
  const { model: _model, sourceCommit: _sourceCommit, ...evidence } = report;
  return JSON.stringify(evidence);
}

function provenanceFields(report: PlannerEvaluationReport) {
  return Number(report.model !== null) + Number(report.sourceCommit !== null);
}
