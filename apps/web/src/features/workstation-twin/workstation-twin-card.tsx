import type {
  TaskRunView,
  WorkstationConfiguration,
  WorkstationSnapshot,
} from "@ergopilot/contracts";
import { useHydrated } from "@tanstack/react-router";
import { Box, Clock3, Eye, TriangleAlert } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MotionProgress } from "@/features/workstation-motion/motion-progress";
import { configurationFromSnapshot } from "@/features/workstation-profile/workstation-profile";

const WorkstationScene = lazy(() =>
  import("./workstation-scene").then((module) => ({
    default: module.WorkstationScene,
  })),
);

interface WorkstationTwinCardProps {
  snapshot: WorkstationSnapshot | undefined;
  run: TaskRunView | undefined;
  isLoading: boolean;
  error: string | null;
}

export function WorkstationTwinCard({
  snapshot,
  run,
  isLoading,
  error,
}: WorkstationTwinCardProps) {
  const hydrated = useHydrated();
  const previewHeightMm = pendingPreviewHeight(run);
  const previewLumbarSupportPercent = pendingPreviewLumbarSupport(run);
  const configuration = snapshot
    ? configurationFromSnapshot(snapshot)
    : undefined;
  const previewConfiguration = configuration
    ? pendingPreviewConfiguration(run, configuration)
    : undefined;
  const stateLabel = twinStateLabel(run);
  const latestProgress = run?.deskMotionProgress.at(-1);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <CardTitle>Workstation digital twin</CardTitle>
            <Badge variant="outline" className="font-mono text-[0.65rem]">
              THREE.JS
            </Badge>
            <Badge variant="outline" className="font-mono text-[0.65rem]">
              RAPIER PHYSICS
            </Badge>
          </div>
          <CardDescription>
            Rust telemetry drives every actuator while Three.js and Rapier
            render a realistic, inspectable workstation twin.
          </CardDescription>
        </div>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
          <Box className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && !snapshot ? (
          <Skeleton className="h-[28rem] w-full rounded-xl" />
        ) : error && !snapshot ? (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>Digital twin unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : snapshot ? (
          <div className="space-y-4">
            <div className="relative h-[32rem] overflow-hidden rounded-xl border bg-[#0d1512]">
              {hydrated ? (
                <Suspense fallback={<SceneFallback />}>
                  <WorkstationScene
                    configuration={configurationFromSnapshot(snapshot)}
                    previewConfiguration={previewConfiguration}
                    uncertain={run?.status === "outcome_unknown"}
                  />
                </Suspense>
              ) : (
                <SceneFallback />
              )}
              <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-white/10 bg-black/35 px-2.5 py-1.5 text-xs text-white/80 backdrop-blur-sm">
                <Eye className="size-3.5" aria-hidden="true" />
                Drag to orbit · Scroll to zoom
              </div>
              <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-2 text-[0.65rem] text-white/75">
                <span className="rounded-md border border-white/10 bg-black/35 px-2 py-1 backdrop-blur-sm">
                  Kinematic actuator
                </span>
                <span className="rounded-md border border-white/10 bg-black/35 px-2 py-1 backdrop-blur-sm">
                  Gravity + collisions
                </span>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border bg-muted/30 px-4 py-3">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-lg border bg-card/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    {run?.status === "executing"
                      ? "Observed desk height"
                      : "Verified desk height"}
                  </p>
                  <p className="mt-1 font-mono text-lg font-semibold">
                    {snapshot.deskHeightMm} mm
                  </p>
                </div>
                <div className="rounded-lg border bg-card/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    Verified lumbar support
                  </p>
                  <p className="mt-1 font-mono text-lg font-semibold">
                    {snapshot.lumbarSupportPercent}%
                  </p>
                </div>
                <TelemetryMetric
                  label="Seat height / depth"
                  value={`${snapshot.seatHeightMm} / ${snapshot.seatDepthMm} mm`}
                />
                <TelemetryMetric
                  label="Backrest"
                  value={`${snapshot.reclineAngleDeg}° · ${snapshot.reclineLocked ? "locked" : "free"} · ${snapshot.reclineResistancePercent}%`}
                />
                <TelemetryMetric
                  label="Task light"
                  value={`${snapshot.lightBrightnessPercent}% · ${snapshot.lightColorTemperatureK} K`}
                />
                <SedentaryReminder snapshot={snapshot} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {previewHeightMm !== undefined && (
                    <Badge
                      variant="outline"
                      className="border-status-warn/40 bg-status-warn/10 text-status-warn"
                    >
                      Preview {previewHeightMm} mm
                    </Badge>
                  )}
                  {previewLumbarSupportPercent !== undefined && (
                    <Badge
                      variant="outline"
                      className="border-status-warn/40 bg-status-warn/10 text-status-warn"
                    >
                      Preview lumbar {previewLumbarSupportPercent}%
                    </Badge>
                  )}
                  {previewConfiguration && run?.task.steps.length === 4 && (
                    <Badge
                      variant="outline"
                      className="border-status-warn/40 bg-status-warn/10 text-status-warn"
                    >
                      Preview complete profile
                    </Badge>
                  )}
                  <Badge variant="secondary">{stateLabel}</Badge>
                  <Badge variant="outline" className="font-mono">
                    state v{snapshot.stateVersion}
                  </Badge>
                </div>
              </div>
              {latestProgress && run?.status === "executing" && (
                <MotionProgress progress={latestProgress} />
              )}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function pendingPreviewHeight(run: TaskRunView | undefined) {
  if (
    run?.status !== "awaiting_approval" ||
    run.approval?.status !== "pending"
  ) {
    return undefined;
  }
  const action = run.task.steps.find(
    (step) => step.action.type === "desk.move_to_height",
  )?.action;
  return action?.type === "desk.move_to_height"
    ? action.input.heightMm
    : undefined;
}

function pendingPreviewLumbarSupport(run: TaskRunView | undefined) {
  if (
    run?.status !== "awaiting_approval" ||
    run.approval?.status !== "pending"
  ) {
    return undefined;
  }
  const action = run.task.steps.find(
    (step) =>
      step.action.type === "chair.set_lumbar_support" ||
      step.action.type === "chair.adjust_ergonomics",
  )?.action;
  if (action?.type === "chair.set_lumbar_support") {
    return action.input.levelPercent;
  }
  return action?.type === "chair.adjust_ergonomics"
    ? action.input.lumbarSupportPercent
    : undefined;
}

function pendingPreviewConfiguration(
  run: TaskRunView | undefined,
  current: WorkstationConfiguration,
) {
  if (
    run?.status !== "awaiting_approval" ||
    run.approval?.status !== "pending"
  ) {
    return undefined;
  }
  let changed = false;
  let next: WorkstationConfiguration = {
    ...current,
    chair: { ...current.chair },
    light: { ...current.light },
    reminder: { ...current.reminder },
  };
  for (const step of run.task.steps) {
    const { action } = step;
    if (action.type === "desk.move_to_height") {
      next = { ...next, deskHeightMm: action.input.heightMm };
      changed = true;
    } else if (action.type === "chair.set_lumbar_support") {
      next = {
        ...next,
        chair: {
          ...next.chair,
          lumbarSupportPercent: action.input.levelPercent,
        },
      };
      changed = true;
    } else if (action.type === "chair.adjust_ergonomics") {
      next = { ...next, chair: action.input };
      changed = true;
    } else if (action.type === "light.configure") {
      next = { ...next, light: action.input };
      changed = true;
    } else if (action.type === "reminder.configure") {
      next = { ...next, reminder: action.input };
      changed = true;
    }
  }
  return changed ? next : undefined;
}

function TelemetryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card/50 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-base font-semibold">{value}</p>
    </div>
  );
}

function SedentaryReminder({ snapshot }: { snapshot: WorkstationSnapshot }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const value = sedentaryReminderValue(snapshot, nowMs);

  return (
    <div className="rounded-lg border bg-card/50 px-3 py-2">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock3 className="size-3.5" aria-hidden="true" />
        Sedentary reminder
      </p>
      <p
        className="mt-1 font-mono text-base font-semibold"
        role="status"
        aria-live="polite"
      >
        {value}
      </p>
    </div>
  );
}

function sedentaryReminderValue(snapshot: WorkstationSnapshot, nowMs: number) {
  if (!snapshot.reminderEnabled) return "Paused";
  if (!snapshot.reminderStartedAtMs) {
    return `${snapshot.reminderIntervalMinutes} min remaining`;
  }

  const intervalMs = snapshot.reminderIntervalMinutes * 60_000;
  const elapsedMs = Math.max(0, nowMs - snapshot.reminderStartedAtMs);
  const cycleElapsedMs = elapsedMs % intervalMs;
  if (elapsedMs >= intervalMs && cycleElapsedMs < 60_000) {
    return "Movement due now";
  }
  return `${Math.ceil((intervalMs - cycleElapsedMs) / 60_000)} min remaining`;
}

function twinStateLabel(run: TaskRunView | undefined) {
  if (run?.status === "awaiting_approval") return "Awaiting approval";
  if (run?.status === "outcome_unknown") return "Outcome uncertain";
  if (run?.status === "suspended") return "Motion suspended";
  if (run?.status === "executing") return "Executing";
  return "Verified state";
}

function SceneFallback() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-white/60">
      Initializing 3D renderer…
    </div>
  );
}
