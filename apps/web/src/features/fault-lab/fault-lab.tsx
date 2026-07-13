import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
  CircleOff,
  FlaskConical,
  History,
  RefreshCw,
  ShieldAlert,
  Unplug,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { controlPlane } from "@/lib/control-plane";

import {
  executeFaultScenario,
  type FaultScenarioId,
  type FaultScenarioResult,
  recoverFaultScenario,
} from "./fault-scenarios";

const scenarios = [
  {
    id: "ack_loss_after_effect",
    title: "ACK loss after effect",
    description:
      "The actuator reaches its target, but the station loses the completion report. The runtime must inspect real state before deciding.",
    expected: "outcome_unknown → reconciled",
    icon: Unplug,
  },
  {
    id: "device_offline_before_effect",
    title: "Device offline before effect",
    description:
      "The command is journaled, then the simulated actuator rejects execution before changing physical state.",
    expected: "failed · zero effects",
    icon: CircleOff,
  },
  {
    id: "device_unavailable_before_dispatch",
    title: "Unavailable before dispatch",
    description:
      "The precondition fails before command creation. The task remains durably suspended and can be resumed safely.",
    expected: "suspended → resumed",
    icon: ShieldAlert,
  },
] as const satisfies ReadonlyArray<{
  id: FaultScenarioId;
  title: string;
  description: string;
  expected: string;
  icon: LucideIcon;
}>;

export function FaultLab() {
  const executeMutation = useMutation({
    mutationFn: (scenarioId: FaultScenarioId) =>
      executeFaultScenario(controlPlane, scenarioId),
  });
  const recoveryMutation = useMutation({
    mutationFn: (result: FaultScenarioResult) =>
      recoverFaultScenario(controlPlane, result),
  });
  const result = recoveryMutation.data ?? executeMutation.data;
  const error = executeMutation.error ?? recoveryMutation.error;
  const isPending = executeMutation.isPending || recoveryMutation.isPending;

  return (
    <main className="mx-auto max-w-[90rem] space-y-6 px-5 py-6 lg:px-8 lg:py-8">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-primary">
          <FlaskConical className="size-4" aria-hidden="true" />
          <span className="font-mono text-xs tracking-wider uppercase">
            Simulator controls
          </span>
        </div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Deterministic fault lab
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Each run creates a fresh approved simulator task, injects exactly one
          fault at the Rust device seam, and captures before/after state. These
          controls never target real hardware.
        </p>
      </div>

      <section
        className="grid gap-4 lg:grid-cols-3"
        aria-label="Available fault scenarios"
      >
        {scenarios.map((scenario) => {
          const Icon = scenario.icon;
          return (
            <Card key={scenario.id}>
              <CardHeader>
                <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon className="size-4" aria-hidden="true" />
                </div>
                <CardTitle>{scenario.title}</CardTitle>
                <CardDescription>{scenario.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md bg-muted/70 px-3 py-2 font-mono text-xs text-muted-foreground">
                  expected: {scenario.expected}
                </div>
              </CardContent>
              <CardFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => {
                    recoveryMutation.reset();
                    executeMutation.mutate(scenario.id);
                  }}
                >
                  {executeMutation.isPending &&
                  executeMutation.variables === scenario.id ? (
                    <RefreshCw className="animate-spin" aria-hidden="true" />
                  ) : (
                    <FlaskConical aria-hidden="true" />
                  )}
                  Inject {scenario.title}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </section>

      {error ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Fault scenario failed to run</CardTitle>
            <CardDescription>{errorMessage(error)}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {result ? (
        <FaultEvidence
          result={result}
          isRecovering={recoveryMutation.isPending}
          onRecover={() => recoveryMutation.mutate(result)}
        />
      ) : (
        <Card className="border-dashed bg-card/60">
          <CardContent className="flex min-h-36 items-center justify-center text-center text-sm text-muted-foreground">
            Select a scenario to create inspectable runtime evidence.
          </CardContent>
        </Card>
      )}
    </main>
  );
}

function FaultEvidence({
  result,
  isRecovering,
  onRecover,
}: {
  result: FaultScenarioResult;
  isRecovering: boolean;
  onRecover: () => void;
}) {
  const movementDelta =
    result.after.movementCount - result.before.movementCount;
  const recoveryLabel =
    result.run.status === "outcome_unknown"
      ? "Reconcile actual state"
      : result.run.status === "suspended"
        ? "Resume suspended run"
        : null;
  const evidence = [
    ...result.run.events.map((event) => ({
      key: `task-${event.sequence}`,
      type: event.eventType,
      atMs: event.atMs,
    })),
    ...result.run.commandEvents.map((event) => ({
      key: `command-${event.sequence}`,
      type: event.eventType,
      atMs: event.atMs,
    })),
  ].sort((left, right) => left.atMs - right.atMs);

  return (
    <section
      className="grid gap-6 lg:grid-cols-12"
      aria-label="Fault evidence"
      aria-live="polite"
    >
      <Card className="lg:col-span-5">
        <CardHeader className="border-b">
          <CardTitle>Scenario outcome</CardTitle>
          <CardDescription className="font-mono">
            {result.scenarioId}
          </CardDescription>
          <CardAction>
            <Badge
              variant={
                result.run.status === "completed"
                  ? "default"
                  : result.run.status === "failed"
                    ? "destructive"
                    : "outline"
              }
            >
              {result.run.status}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <EvidenceMetric
              label="Desk before"
              value={`${result.before.deskHeightMm} mm`}
            />
            <EvidenceMetric
              label="Desk observed"
              value={`${result.after.deskHeightMm} mm`}
            />
            <EvidenceMetric
              label="Target"
              value={`${result.targetHeightMm} mm`}
            />
            <EvidenceMetric
              label="Movement delta"
              value={`${movementDelta >= 0 ? "+" : ""}${movementDelta} physical ${movementDelta === 1 ? "effect" : "effects"}`}
            />
          </div>
          <div className="rounded-lg bg-muted/70 p-3 font-mono text-xs text-muted-foreground">
            run {result.run.runId}
          </div>
        </CardContent>
        <CardFooter className="gap-2">
          {recoveryLabel ? (
            <Button type="button" onClick={onRecover} disabled={isRecovering}>
              <RefreshCw
                className={isRecovering ? "animate-spin" : undefined}
                aria-hidden="true"
              />
              {recoveryLabel}
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <Link to="/" search={{ runId: result.run.runId }}>
              Open full run
            </Link>
          </Button>
        </CardFooter>
      </Card>

      <Card className="lg:col-span-7">
        <CardHeader className="border-b">
          <CardTitle>Ordered runtime evidence</CardTitle>
          <CardDescription>
            Task and command events captured from the durable read model.
          </CardDescription>
          <CardAction>
            <History
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
          </CardAction>
        </CardHeader>
        <CardContent>
          {evidence.length > 0 ? (
            <ol className="space-y-3">
              {evidence.map((event) => (
                <li key={event.key} className="flex items-center gap-3">
                  <span className="size-1.5 rounded-full bg-primary" />
                  <span className="font-mono text-xs">{event.type}</span>
                  <span className="ml-auto font-mono text-[0.68rem] text-muted-foreground">
                    {event.atMs} ms
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">
              This fixture has no event payload. Inspect the linked run for the
              authoritative journal.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function EvidenceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm font-medium">{value}</div>
    </div>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown fault lab error";
}
