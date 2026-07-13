import { createFileRoute } from "@tanstack/react-router";

import { EvaluationDashboard } from "@/features/evaluation-dashboard/evaluation-dashboard";

export const Route = createFileRoute("/evals")({
  component: EvaluationDashboard,
});
