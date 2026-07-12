import type { TaskRunView } from "@ergopilot/contracts";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const presentation = {
  awaiting_approval: {
    label: "Awaiting approval",
    className: "border-status-warn/30 bg-status-warn/10 text-status-warn",
  },
  executing: {
    label: "Executing",
    className: "border-status-info/30 bg-status-info/10 text-status-info",
  },
  completed: {
    label: "Completed",
    className: "border-status-ok/30 bg-status-ok/10 text-status-ok",
  },
  outcome_unknown: {
    label: "Outcome unknown",
    className: "border-status-warn/30 bg-status-warn/10 text-status-warn",
  },
  failed: {
    label: "Failed",
    className:
      "border-destructive/30 bg-destructive/10 text-destructive dark:text-red-300",
  },
  denied: {
    label: "Denied",
    className:
      "border-destructive/30 bg-destructive/10 text-destructive dark:text-red-300",
  },
  suspended: {
    label: "Suspended",
    className: "border-status-warn/30 bg-status-warn/10 text-status-warn",
  },
} satisfies Record<TaskRunView["status"], { label: string; className: string }>;

export function StatusBadge({ status }: { status: TaskRunView["status"] }) {
  const value = presentation[status];
  return (
    <Badge variant="outline" className={cn("font-medium", value.className)}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {value.label}
    </Badge>
  );
}
