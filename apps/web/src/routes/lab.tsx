import { createFileRoute } from "@tanstack/react-router";

import { FaultLab } from "@/features/fault-lab/fault-lab";

export const Route = createFileRoute("/lab")({
  component: FaultLab,
});
