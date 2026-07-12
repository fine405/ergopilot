import type { TaskSpec } from "@ergopilot/contracts";
import { ArrowRight, MoveVertical, ShieldCheck } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

import { buildFocusTask } from "./task-builder";

const heightPresets = [720, 780, 1_050];

interface TaskComposerProps {
  onSubmit: (task: TaskSpec) => Promise<void>;
  isPending: boolean;
  error: string | null;
}

export function TaskComposer({
  onSubmit,
  isPending,
  error,
}: TaskComposerProps) {
  const [requestedBy, setRequestedBy] = useState("demo-user");
  const [deskHeightMm, setDeskHeightMm] = useState(780);
  const [durationMinutes, setDurationMinutes] = useState(45);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deskHeightMm < 620 || deskHeightMm > 1_280) {
      setValidationError("Desk height must stay within 620–1280 mm.");
      return;
    }
    setValidationError(null);
    try {
      await onSubmit(
        buildFocusTask({
          taskId: `task-${crypto.randomUUID()}`,
          requestedBy,
          deskHeightMm,
          durationMinutes,
        }),
      );
    } catch {
      // React Query exposes the mutation error through the `error` prop.
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="mb-2 flex size-9 items-center justify-center rounded-lg border bg-muted">
          <MoveVertical className="size-4 text-primary" aria-hidden="true" />
        </div>
        <CardTitle>Manual task builder</CardTitle>
        <CardDescription>
          Deterministic fallback with no model dependency. Motion still waits
          for approval.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="requested-by">Requested by</Label>
            <Input
              id="requested-by"
              value={requestedBy}
              onChange={(event) => setRequestedBy(event.target.value)}
              required
              autoComplete="username"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="desk-height">Target desk height</Label>
              <span className="font-mono text-xs text-muted-foreground">
                safe: 620–1280 mm
              </span>
            </div>
            <div className="relative">
              <Input
                id="desk-height"
                type="number"
                min={620}
                max={1_280}
                value={deskHeightMm}
                onChange={(event) =>
                  setDeskHeightMm(event.target.valueAsNumber)
                }
                className="pr-12 font-mono"
                required
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                mm
              </span>
            </div>
            <div className="flex gap-2">
              {heightPresets.map((height) => (
                <Button
                  key={height}
                  type="button"
                  size="sm"
                  variant={deskHeightMm === height ? "secondary" : "outline"}
                  onClick={() => setDeskHeightMm(height)}
                  className="font-mono"
                >
                  {height}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="duration">Focus duration</Label>
            <div className="relative">
              <Input
                id="duration"
                type="number"
                min={15}
                max={180}
                step={5}
                value={durationMinutes}
                onChange={(event) =>
                  setDurationMinutes(event.target.valueAsNumber)
                }
                className="pr-16 font-mono"
                required
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                minutes
              </span>
            </div>
          </div>

          <Separator />

          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">Deterministic plan</span>
              <span className="font-mono text-muted-foreground">1 step</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <div className="flex size-7 items-center justify-center rounded-md bg-background font-mono text-xs ring-1 ring-border">
                01
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">desk.move_to_height</p>
                <p className="font-mono text-xs text-muted-foreground">
                  heightMm: {deskHeightMm}
                </p>
              </div>
              <ShieldCheck
                className="size-4 text-status-warn"
                aria-label="Approval required"
              />
            </div>
          </div>

          {(validationError || error) && (
            <Alert variant="destructive">
              <AlertTitle>Task not started</AlertTitle>
              <AlertDescription>{validationError ?? error}</AlertDescription>
            </Alert>
          )}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={isPending}
          >
            {isPending ? "Creating run…" : "Create task run"}
            {!isPending && <ArrowRight data-icon="inline-end" />}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
