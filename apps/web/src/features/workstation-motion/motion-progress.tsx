import type { DeskMotionProgress } from "@ergopilot/contracts";

import { cn } from "@/lib/utils";

interface MotionProgressProps {
  progress: DeskMotionProgress;
  className?: string;
}

export function MotionProgress({ progress, className }: MotionProgressProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">Rust device progress</span>
        <span className="font-mono">
          {progress.progressPercent}% · {progress.deskHeightMm} mm
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Desk motion progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.progressPercent}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-100 ease-linear"
          style={{ width: `${progress.progressPercent}%` }}
        />
      </div>
    </div>
  );
}
