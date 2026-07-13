import type { TaskRunView } from "@ergopilot/contracts";
import {
  Activity,
  CheckCircle2,
  CircleDotDashed,
  Clock3,
  type LucideIcon,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  XCircle,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type TaskEvent = TaskRunView["events"][number];
type TaskEventType = TaskEvent["eventType"];
type CommandEvent = TaskRunView["commandEvents"][number];
type CommandEventType = CommandEvent["eventType"];
type Presentation = [string, LucideIcon, string];

type TimelineItem =
  | { source: "task"; event: TaskEvent }
  | { source: "station"; event: CommandEvent };

const taskEventPresentation = {
  run_started: ["Run created", CircleDotDashed, "text-status-info"],
  approval_required: ["Approval required", Clock3, "text-status-warn"],
  approval_granted: ["Approval granted", ShieldCheck, "text-status-ok"],
  approval_expired: ["Approval expired", TriangleAlert, "text-status-warn"],
  command_dispatched: [
    "Command dispatched",
    CircleDotDashed,
    "text-status-info",
  ],
  run_completed: ["Run completed", CheckCircle2, "text-status-ok"],
  outcome_unknown: ["Run outcome unknown", TriangleAlert, "text-status-warn"],
  run_failed: ["Run failed", XCircle, "text-destructive"],
  policy_denied: ["Policy denied", XCircle, "text-destructive"],
  run_reconciled: ["Run reconciled", CheckCircle2, "text-status-ok"],
  run_resume_attempted: [
    "Resume attempt recorded",
    RefreshCw,
    "text-status-info",
  ],
  run_resumed: ["Run resumed", CheckCircle2, "text-status-ok"],
  run_suspended: ["Run suspended", TriangleAlert, "text-status-warn"],
  run_cancelled: ["Run cancelled", XCircle, "text-muted-foreground"],
} satisfies Record<TaskEventType, Presentation>;

const commandEventPresentation = {
  accepted: ["Command accepted", CircleDotDashed, "text-status-info"],
  executing: ["Device executing", Activity, "text-status-info"],
  outcome_unknown: [
    "Physical outcome unknown",
    TriangleAlert,
    "text-status-warn",
  ],
  verified_succeeded: ["Device state verified", ShieldCheck, "text-status-ok"],
  verification_failed: [
    "State verification failed",
    TriangleAlert,
    "text-destructive",
  ],
  execution_failed: ["Device execution failed", XCircle, "text-destructive"],
  reconciliation_pending: [
    "Reconciliation started",
    RefreshCw,
    "text-status-warn",
  ],
  reconciled_succeeded: [
    "Device state reconciled",
    CheckCircle2,
    "text-status-ok",
  ],
} satisfies Record<CommandEventType, Presentation>;

const terminalTaskEvents = new Set<TaskEventType>([
  "run_completed",
  "outcome_unknown",
  "run_failed",
  "policy_denied",
  "run_reconciled",
  "run_resumed",
  "run_suspended",
  "run_cancelled",
]);

const eventTimeFormatter = new Intl.DateTimeFormat("en", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

interface RunTimelineProps {
  taskEvents: TaskRunView["events"];
  commandEvents: TaskRunView["commandEvents"];
}

export function RunTimeline({ taskEvents, commandEvents }: RunTimelineProps) {
  const timeline = mergeTimeline(taskEvents, commandEvents);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Execution timeline</CardTitle>
        <CardDescription>
          Durable task and station events in causal order
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-0">
          {timeline.map((item, index) => {
            const [label, Icon, color] = presentationFor(item);
            const isLast = index === timeline.length - 1;
            return (
              <li
                key={`${item.source}-${item.event.eventType}-${item.event.sequence}`}
                className="relative flex gap-4 pb-6 last:pb-0"
              >
                {!isLast && (
                  <span
                    className="absolute left-[15px] top-8 h-[calc(100%-1rem)] w-px bg-border"
                    aria-hidden="true"
                  />
                )}
                <span
                  className={cn(
                    "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border bg-background",
                    color,
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1 pt-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{label}</p>
                    <time className="font-mono text-xs text-muted-foreground">
                      {formatEventTime(item.event.atMs)}
                    </time>
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {item.source} #
                    {String(item.event.sequence).padStart(2, "0")}
                    {" · "}
                    {item.event.eventType}
                  </p>
                  {item.source === "task" && item.event.actorId && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Operator ·{" "}
                      <span className="font-mono">{item.event.actorId}</span>
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

export function mergeTimeline(
  taskEvents: TaskRunView["events"],
  commandEvents: TaskRunView["commandEvents"],
): TimelineItem[] {
  return [
    ...taskEvents.map((event) => ({ source: "task" as const, event })),
    ...commandEvents.map((event) => ({ source: "station" as const, event })),
  ].sort((left, right) => {
    const timeDifference = left.event.atMs - right.event.atMs;
    if (timeDifference !== 0) return timeDifference;
    const phaseDifference = eventPhase(left) - eventPhase(right);
    if (phaseDifference !== 0) return phaseDifference;
    return left.event.sequence - right.event.sequence;
  });
}

function eventPhase(item: TimelineItem) {
  if (item.source === "station") return 1;
  return terminalTaskEvents.has(item.event.eventType) ? 2 : 0;
}

function presentationFor(item: TimelineItem): Presentation {
  return item.source === "task"
    ? taskEventPresentation[item.event.eventType]
    : commandEventPresentation[item.event.eventType];
}

function formatEventTime(atMs: number) {
  return eventTimeFormatter.format(new Date(atMs));
}
