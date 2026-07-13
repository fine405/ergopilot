import type { PlannerAttempt } from "@ergopilot/contracts";
import { Activity, RefreshCw, TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const numberFormatter = new Intl.NumberFormat("en-US");

interface PlannerAttemptsCardProps {
  attempts: PlannerAttempt[] | undefined;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export function PlannerAttemptsCard({
  attempts,
  isLoading,
  error,
  onRefresh,
}: PlannerAttemptsCardProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <CardTitle>Planner attempts</CardTitle>
            {attempts ? (
              <Badge variant="outline" className="font-mono text-[0.65rem]">
                {attempts.length}/100
              </Badge>
            ) : null}
          </div>
          <CardDescription>
            Privacy-safe evidence from the latest Agent planning requests
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          disabled={isLoading}
          aria-label="Refresh planner attempts"
        >
          <RefreshCw className={isLoading ? "animate-spin" : undefined} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <Alert variant={attempts ? undefined : "destructive"}>
            <TriangleAlert />
            <AlertTitle>
              {attempts ? "Showing cached attempts" : "Attempts unavailable"}
            </AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {isLoading && !attempts ? (
          <div className="space-y-3">
            {["attempt-1", "attempt-2", "attempt-3"].map((item) => (
              <Skeleton key={item} className="h-20 w-full" />
            ))}
          </div>
        ) : error && !attempts ? null : attempts && attempts.length > 0 ? (
          <div className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
            {attempts.map((attempt) => (
              <PlannerAttemptRow key={attempt.traceId} attempt={attempt} />
            ))}
          </div>
        ) : (
          <div className="flex min-h-32 flex-col items-center justify-center rounded-lg border border-dashed text-center">
            <Activity className="mb-3 size-5 text-muted-foreground" />
            <p className="text-sm font-medium">No planning attempts yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Generate a plan to create the first trace.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PlannerAttemptRow({ attempt }: { attempt: PlannerAttempt }) {
  const attributed = attempt.provider !== null && attempt.model !== null;
  const startedAtIso = new Date(attempt.startedAtMs).toISOString();

  return (
    <article className="rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            variant="outline"
            className={
              attempt.outcome === "succeeded"
                ? "border-status-ok/30 bg-status-ok/10 text-status-ok"
                : "border-destructive/30 bg-destructive/10 text-destructive dark:text-red-300"
            }
          >
            {attempt.outcome}
          </Badge>
          <span className="truncate font-mono text-xs">{attempt.traceId}</span>
        </div>
        <div className="text-right font-mono text-xs text-muted-foreground">
          <span className="block">
            {numberFormatter.format(attempt.durationMs)} ms
          </span>
          <time dateTime={startedAtIso} className="mt-1 block text-[0.65rem]">
            {startedAtIso}
          </time>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate text-muted-foreground">
          {attributed ? attempt.model : "Unattributed request"}
        </span>
        <span
          className={
            attempt.outcome === "succeeded"
              ? "font-mono text-foreground"
              : "font-mono text-destructive"
          }
        >
          {attempt.outcome === "succeeded" ? attempt.taskId : attempt.errorCode}
        </span>
      </div>
    </article>
  );
}
