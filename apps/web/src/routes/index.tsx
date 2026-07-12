import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { OperatorConsole } from "@/features/operator-console/operator-console";

const searchSchema = z.object({
  runId: z.string().optional(),
});

export const Route = createFileRoute("/")({
  validateSearch: searchSchema,
  component: Home,
});

function Home() {
  const { runId } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <OperatorConsole
      runId={runId}
      onRunIdChange={(nextRunId) =>
        navigate({
          replace: true,
          search: (previous) => ({ ...previous, runId: nextRunId }),
        })
      }
    />
  );
}
