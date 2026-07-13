import type { WorkstationSnapshot } from "@ergopilot/contracts";
import { Activity, RefreshCw } from "lucide-react";

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

interface StationCardProps {
  snapshot: WorkstationSnapshot | undefined;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export function StationCard({
  snapshot,
  isLoading,
  error,
  onRefresh,
}: StationCardProps) {
  const position = snapshot
    ? Math.min(100, Math.max(0, ((snapshot.deskHeightMm - 620) / 660) * 100))
    : 0;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <CardTitle>Station telemetry</CardTitle>
            {snapshot && (
              <Badge
                variant="outline"
                className="border-status-ok/30 bg-status-ok/10 text-status-ok"
              >
                live
              </Badge>
            )}
          </div>
          <CardDescription>Verified simulator state</CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          disabled={isLoading}
          aria-label="Refresh station telemetry"
        >
          <RefreshCw className={isLoading ? "animate-spin" : undefined} />
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading && !snapshot ? (
          <div className="space-y-4">
            <Skeleton className="h-12 w-36" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : error && !snapshot ? (
          <Alert variant="destructive">
            <Activity />
            <AlertTitle>Station unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : snapshot ? (
          <div className="space-y-5">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-4xl font-semibold tracking-tight">
                  {snapshot.deskHeightMm}
                </span>
                <span className="text-sm text-muted-foreground">mm</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Desk height</p>
            </div>
            <meter
              className="sr-only"
              min={620}
              max={1280}
              value={snapshot.deskHeightMm}
            >
              {snapshot.deskHeightMm} mm inside the 620–1280 mm safe envelope
            </meter>
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              aria-hidden="true"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${position}%` }}
              />
            </div>
            <dl className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border bg-muted/30 p-3">
                <dt className="text-xs text-muted-foreground">Lumbar</dt>
                <dd className="mt-1 font-mono text-sm">
                  {snapshot.lumbarSupportPercent}%
                </dd>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <dt className="text-xs text-muted-foreground">State version</dt>
                <dd className="mt-1 font-mono text-sm">
                  v{snapshot.stateVersion}
                </dd>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <dt className="text-xs text-muted-foreground">Movements</dt>
                <dd className="mt-1 font-mono text-sm">
                  {snapshot.movementCount}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
