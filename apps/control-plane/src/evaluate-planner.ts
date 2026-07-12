import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { plannerProviderIdSchema } from "@ergopilot/contracts";

import {
  PLANNER_EVALUATION_CASES,
  runPlannerEvaluation,
} from "./planner-evaluation";
import {
  createConfiguredTaskPlanners,
  PLANNER_PROVIDERS,
} from "./task-planner";

try {
  loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

async function main() {
  const providerArgument = process.argv
    .slice(2)
    .find((value) => value !== "--");
  const provider = plannerProviderIdSchema.parse(
    providerArgument ?? "deepseek",
  );
  const planner = createConfiguredTaskPlanners()[provider];
  if (!planner) {
    throw new Error(
      `Set ${PLANNER_PROVIDERS[provider].keyEnvVar} in .env before running the planner evaluation`,
    );
  }

  const report = await runPlannerEvaluation(
    planner,
    provider,
    PLANNER_EVALUATION_CASES,
  );
  console.log(JSON.stringify(report, null, 2));
  if (report.passedCases !== report.totalCases) process.exitCode = 1;
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "evaluation failed");
  process.exitCode = 1;
});
