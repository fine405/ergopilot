import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { plannerProviderIdSchema } from "@ergopilot/contracts";

import {
  PLANNER_EVALUATION_CASES,
  PLANNER_EVALUATION_SMOKE_CASES,
  type PlannerEvaluationSuite,
  runPlannerEvaluation,
  savePlannerEvaluationReport,
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
  const arguments_ = process.argv.slice(2).filter((value) => value !== "--");
  const providerArgument = arguments_[0];
  const provider = plannerProviderIdSchema.parse(
    providerArgument ?? "deepseek",
  );
  const suiteArgument = arguments_[1] ?? "smoke";
  if (suiteArgument !== "smoke" && suiteArgument !== "full") {
    throw new Error('Evaluation suite must be either "smoke" or "full"');
  }
  const suite: PlannerEvaluationSuite = suiteArgument;
  const planner = createConfiguredTaskPlanners()[provider];
  if (!planner) {
    throw new Error(
      `Set ${PLANNER_PROVIDERS[provider].keyEnvVar} in .env before running the planner evaluation`,
    );
  }

  const report = await runPlannerEvaluation(
    planner,
    provider,
    suite === "full"
      ? PLANNER_EVALUATION_CASES
      : PLANNER_EVALUATION_SMOKE_CASES,
  );
  const reportPath = await savePlannerEvaluationReport(
    report,
    suite,
    fileURLToPath(new URL("../../../target/evaluations", import.meta.url)),
  );
  console.log(JSON.stringify(report, null, 2));
  console.log(`Saved report to ${reportPath}`);
  if (report.passedCases !== report.totalCases) process.exitCode = 1;
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "evaluation failed");
  process.exitCode = 1;
});
