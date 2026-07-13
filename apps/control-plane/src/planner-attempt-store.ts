import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  type PlannerAttempt,
  plannerAttemptSchema,
  plannerAttemptsResponseSchema,
} from "@ergopilot/contracts";

const maximumAttempts = 100;

export interface PlannerAttemptStore {
  list(): PlannerAttempt[];
  record(attempt: PlannerAttempt): Promise<void>;
}

export class PlannerAttemptStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PlannerAttemptStoreError";
  }
}

export function createMemoryPlannerAttemptStore(
  initialAttempts: readonly PlannerAttempt[] = [],
): PlannerAttemptStore {
  let attempts = validateAttempts(initialAttempts);
  return {
    list: () => [...attempts],
    record: async (attempt) => {
      attempts = prependAttempt(attempts, attempt);
    },
  };
}

export async function openFilePlannerAttemptStore(
  filePath: string,
): Promise<PlannerAttemptStore> {
  let attempts = await readAttempts(filePath);
  let writeQueue = Promise.resolve();

  return {
    list: () => [...attempts],
    record: (attempt) => {
      const parsedAttempt = plannerAttemptSchema.parse(attempt);
      const write = writeQueue.then(async () => {
        const nextAttempts = prependAttempt(attempts, parsedAttempt);
        await writeAttempts(filePath, nextAttempts);
        attempts = nextAttempts;
      });
      writeQueue = write.then(
        () => undefined,
        () => undefined,
      );
      return write;
    },
  };
}

function prependAttempt(
  attempts: readonly PlannerAttempt[],
  attempt: PlannerAttempt,
) {
  return validateAttempts([attempt, ...attempts].slice(0, maximumAttempts));
}

function validateAttempts(attempts: readonly PlannerAttempt[]) {
  return plannerAttemptsResponseSchema.parse({ attempts: [...attempts] })
    .attempts;
}

async function readAttempts(filePath: string): Promise<PlannerAttempt[]> {
  try {
    const contents = await readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(contents);
    return plannerAttemptsResponseSchema.parse(parsed).attempts;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new PlannerAttemptStoreError(
      "planner attempt store could not be opened",
      { cause: error },
    );
  }
}

async function writeAttempts(
  filePath: string,
  attempts: readonly PlannerAttempt[],
) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify({ attempts }, null, 2)}\n`,
      { mode: 0o600 },
    );
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw new PlannerAttemptStoreError(
      "planner attempt store could not be written",
      { cause: error },
    );
  }
}
