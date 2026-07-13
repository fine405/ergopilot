import type { TaskRunView } from "@ergopilot/contracts";
import {
  CircleDashed,
  CircleOff,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { presentTask } from "@/features/device-action";
import { MotionProgress } from "@/features/workstation-motion/motion-progress";

import { RunTimeline } from "./run-timeline";
import { StatusBadge } from "./status-badge";

const expiryFormatter = new Intl.DateTimeFormat("en", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

interface RunOverviewProps {
  run: TaskRunView | undefined;
  isLoading: boolean;
  error: string | null;
  isMutating: boolean;
  onApprove: (run: TaskRunView) => void;
  onCancel: (run: TaskRunView) => void;
  onApproveWithAckLoss: (run: TaskRunView) => void;
  onApproveWithDeviceOffline: (run: TaskRunView) => void;
  onApproveWithDeviceUnavailableBeforeDispatch: (run: TaskRunView) => void;
  onResume: (run: TaskRunView) => void;
  onReconcile: (run: TaskRunView) => void;
}

export function RunOverview({
  run,
  isLoading,
  error,
  isMutating,
  onApprove,
  onCancel,
  onApproveWithAckLoss,
  onApproveWithDeviceOffline,
  onApproveWithDeviceUnavailableBeforeDispatch,
  onResume,
  onReconcile,
}: RunOverviewProps) {
  if (isLoading && !run) {
    return <RunSkeleton />;
  }
  if (error && !run) {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>Run unavailable</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!run) {
    return (
      <Card className="flex min-h-[30rem] items-center justify-center border-dashed bg-card/40">
        <CardContent className="max-w-md py-16 text-center">
          <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-xl border bg-muted">
            <CircleDashed className="size-5 text-muted-foreground" />
          </div>
          <CardTitle>No active task run</CardTitle>
          <CardDescription className="mt-2 leading-relaxed">
            Create a typed plan to inspect its policy decision, approval
            checkpoint, command result, and durable recovery timeline.
          </CardDescription>
        </CardContent>
      </Card>
    );
  }

  const presentation = presentTask(run.task);
  const commandCount = run.task.steps.length;
  const approvalPending =
    run.status === "awaiting_approval" && run.approval?.status === "pending";
  const canReconcile = run.status === "outcome_unknown";
  const canResume =
    run.status === "suspended" &&
    (run.suspensionReason === "device_unavailable" ||
      run.suspensionReason === "actuator_fault");
  const latestProgress = run.deskMotionProgress.at(-1);
  const commandTimelineEvents = collectCommandEvents(run);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <CardTitle>Task run</CardTitle>
                <StatusBadge status={run.status} />
              </div>
              <CardDescription className="font-mono">
                {run.runId}
              </CardDescription>
            </div>
            {run.suspensionReason === "actuator_fault" && canResume ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" disabled={isMutating}>
                    <RefreshCw
                      className={isMutating ? "animate-spin" : undefined}
                    />
                    Clear fault & resume
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Clear the fault and authorize remaining motion?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      The failed command stays terminal. The runtime will read
                      the current physical state and, only while the original
                      approval remains valid, issue a new bounded command for
                      the remaining distance.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep suspended</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onResume(run)}>
                      Confirm clear & resume
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : canReconcile || canResume ? (
              <Button
                variant="outline"
                onClick={() => (canResume ? onResume(run) : onReconcile(run))}
                disabled={isMutating}
              >
                <RefreshCw
                  className={isMutating ? "animate-spin" : undefined}
                />
                {canResume ? "Resume run" : "Reconcile state"}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <dl className="grid gap-3 sm:grid-cols-3">
            <Metric label="Goal" value={presentation.goal} />
            <Metric label="Target" value={presentation.target} mono />
            <Metric
              label="Duration"
              value={`${run.task.constraints.durationMinutes ?? "—"} min`}
              mono
            />
          </dl>

          <Separator />

          <div>
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" />
              <h3 className="text-sm font-medium">Policy evidence</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{run.policyDecision.outcome}</Badge>
              {run.policyDecision.ruleIds.map((rule) => (
                <Badge key={rule} variant="outline" className="font-mono">
                  {rule}
                </Badge>
              ))}
            </div>
          </div>

          {latestProgress && (
            <div className="rounded-xl border bg-muted/20 p-4">
              <MotionProgress progress={latestProgress} />
            </div>
          )}

          {(run.commandAttempts?.length ?? 0) > 0 && (
            <div className="space-y-3 rounded-xl border border-status-warn/30 bg-status-warn/5 p-4">
              <div>
                <h3 className="text-sm font-medium">Prior command attempts</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Immutable failure evidence retained after recovery.
                </p>
              </div>
              {run.commandAttempts?.map((attempt) => {
                const progress = attempt.deskMotionProgress.at(-1);
                return (
                  <div
                    key={attempt.command.commandId}
                    className="grid gap-2 rounded-lg border bg-background/60 p-3 sm:grid-cols-[1fr_auto]"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs">
                        {attempt.command.commandId}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {attempt.command.failureReason ??
                          attempt.command.status}
                      </p>
                    </div>
                    {progress ? (
                      <p className="font-mono text-xs text-status-warn">
                        stopped at {progress.progressPercent}% ·{" "}
                        {progress.deskHeightMm} mm
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {approvalPending && run.approval && (
            <div className="flex flex-col gap-4 rounded-xl border border-status-warn/30 bg-status-warn/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-status-warn/10 text-status-warn">
                  <ShieldAlert className="size-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">
                    Physical motion requires approval
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {presentation.pendingSummary}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" disabled={isMutating}>
                      Cancel run
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Cancel this pending run?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        The runtime will close this approval request before a
                        device command is created. The cancelled run cannot be
                        approved or resumed.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep waiting</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => onCancel(run)}
                      >
                        Confirm cancellation
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button disabled={isMutating}>Review & approve</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {presentation.authorizationTitle}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        This grant is scoped to run {run.runId}, its{" "}
                        {commandCount === 1
                          ? "exact command"
                          : `${commandCount} exact ordered commands`}
                        , {presentation.scopeTarget}, and the state version used
                        by the plan. It cannot authorize a different movement.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="rounded-lg border bg-muted/40 p-3 font-mono text-xs">
                      approval: {run.approval.approvalId}
                      <br />
                      expires: {formatExpiry(run.approval.expiresAtMs)}
                    </div>
                    <div className="space-y-3 rounded-lg border border-dashed p-3">
                      <div>
                        <p className="text-sm font-medium">
                          Fault injection lab
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Demo-only paths; normal approval remains unchanged.
                        </p>
                      </div>
                      <div className="grid gap-2">
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => onApproveWithAckLoss(run)}
                          className="h-auto min-h-8 whitespace-normal! py-2"
                        >
                          Approve + lose ACK (demo)
                        </AlertDialogAction>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => onApproveWithDeviceOffline(run)}
                          className="h-auto min-h-8 whitespace-normal! py-2"
                        >
                          Approve + device offline (demo)
                        </AlertDialogAction>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() =>
                            onApproveWithDeviceUnavailableBeforeDispatch(run)
                          }
                          className="h-auto min-h-8 whitespace-normal! py-2"
                        >
                          Approve + unavailable before dispatch (demo)
                        </AlertDialogAction>
                      </div>
                    </div>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => onApprove(run)}>
                        {commandCount === 1
                          ? "Approve one motion"
                          : `Approve ${commandCount} motions`}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          )}

          <RunStateAlert run={run} />
          {error && (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>Action failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <RunTimeline
        taskEvents={run.events}
        commandEvents={commandTimelineEvents}
      />
    </div>
  );
}

function collectCommandEvents(run: TaskRunView) {
  const events = [
    ...(run.completedSteps?.flatMap((step) => step.commandEvents) ?? []),
    ...(run.commandAttempts?.flatMap((attempt) => attempt.commandEvents) ?? []),
    ...run.commandEvents,
  ];
  return Array.from(
    new Map(
      events.map((event) => [`${event.commandId}:${event.sequence}`, event]),
    ).values(),
  ).sort((left, right) => left.sequence - right.sequence);
}

function Metric({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={mono ? "mt-1 font-mono text-sm" : "mt-1 text-sm font-medium"}
      >
        {value}
      </dd>
    </div>
  );
}

function RunStateAlert({ run }: { run: TaskRunView }) {
  if (run.approval?.status === "expired") {
    return (
      <Alert className="border-status-warn/30 bg-status-warn/5">
        <TriangleAlert className="text-status-warn" />
        <AlertTitle>Approval expired</AlertTitle>
        <AlertDescription>
          This grant can no longer authorize motion. Create a fresh task run to
          request a new approval against current station state.
        </AlertDescription>
      </Alert>
    );
  }
  if (run.status === "completed") {
    return (
      <Alert className="border-status-ok/30 bg-status-ok/5">
        <ShieldCheck className="text-status-ok" />
        <AlertTitle>Verified completion</AlertTitle>
        <AlertDescription>
          The runtime read the device state after execution and observed the{" "}
          {presentTask(run.task).verifiedState}.
        </AlertDescription>
      </Alert>
    );
  }
  if (run.status === "cancelled") {
    return (
      <Alert>
        <CircleOff />
        <AlertTitle>Run cancelled before dispatch</AlertTitle>
        <AlertDescription>
          The requester closed the pending approval. No device command was
          created and no physical action was attempted.
        </AlertDescription>
      </Alert>
    );
  }
  if (run.status === "suspended") {
    if (run.suspensionReason === "stale_state") {
      return (
        <Alert className="border-status-warn/30 bg-status-warn/5">
          <TriangleAlert className="text-status-warn" />
          <AlertTitle>Station state changed</AlertTitle>
          <AlertDescription>
            The planned state version no longer matches the workstation. Create
            a fresh task run against the current station state.
          </AlertDescription>
        </Alert>
      );
    }
    if (run.suspensionReason === "expired") {
      return (
        <Alert className="border-status-warn/30 bg-status-warn/5">
          <TriangleAlert className="text-status-warn" />
          <AlertTitle>Persisted intent expired</AlertTitle>
          <AlertDescription>
            The saved command or policy grant can no longer authorize motion.
            Create a fresh task run to request a new approval.
          </AlertDescription>
        </Alert>
      );
    }
    if (run.suspensionReason === "device_unavailable") {
      return (
        <Alert className="border-status-warn/30 bg-status-warn/5">
          <TriangleAlert className="text-status-warn" />
          <AlertTitle>Run suspended safely</AlertTitle>
          <AlertDescription>
            The runtime stopped before recording a terminal device outcome.
            Resume re-checks connectivity, approval, and station state; invalid
            preconditions remain suspended.
          </AlertDescription>
        </Alert>
      );
    }
    if (run.suspensionReason === "actuator_fault") {
      return (
        <Alert className="border-status-warn/30 bg-status-warn/5">
          <TriangleAlert className="text-status-warn" />
          <AlertTitle>Actuator stopped after a partial effect</AlertTitle>
          <AlertDescription>
            The failed command will not be replayed. After the obstruction is
            cleared, resume reads the physical state and creates a new bounded
            command for the remaining motion.
          </AlertDescription>
        </Alert>
      );
    }
    return (
      <Alert className="border-status-warn/30 bg-status-warn/5">
        <TriangleAlert className="text-status-warn" />
        <AlertTitle>Suspension reason unavailable</AlertTitle>
        <AlertDescription>
          The runtime has no structured recovery reason for this run. Create a
          fresh task run against current station state.
        </AlertDescription>
      </Alert>
    );
  }
  if (
    run.status === "failed" &&
    run.commandEvents.some((event) => event.eventType === "execution_failed")
  ) {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>Execution rejected before effect</AlertTitle>
        <AlertDescription>
          The adapter proved no physical effect occurred, so the runtime did not
          retry. Create a fresh run after the device is available.
        </AlertDescription>
      </Alert>
    );
  }
  if (["failed", "denied"].includes(run.status)) {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>Run stopped safely</AlertTitle>
        <AlertDescription>
          The runtime did not continue past its current safety or recovery
          boundary. Inspect the timeline for evidence.
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}

function RunSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-4 w-64" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {["goal", "target", "duration"].map((metric) => (
            <Skeleton key={metric} className="h-16" />
          ))}
        </div>
        <Skeleton className="h-24" />
      </CardContent>
    </Card>
  );
}

function formatExpiry(expiresAtMs: number) {
  return expiryFormatter.format(new Date(expiresAtMs));
}
