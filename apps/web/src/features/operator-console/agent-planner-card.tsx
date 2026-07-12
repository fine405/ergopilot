import type {
  PlannerProvider,
  PlannerProviderId,
  TaskPlanRequest,
  TaskPlanResponse,
  TaskSpec,
} from "@ergopilot/contracts";
import { ArrowRight, ShieldCheck, WandSparkles } from "lucide-react";
import { type FormEvent, useState } from "react";

import {
  Task,
  TaskContent,
  TaskItem,
  TaskTrigger,
} from "@/components/ai-elements/task";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const examplePrompt =
  "I want to stand and focus for 45 minutes. Set the desk to 790 mm and only interrupt me for critical issues.";

interface AgentPlannerCardProps {
  providers: PlannerProvider[] | undefined;
  providerError?: string | null;
  plan: TaskPlanResponse | undefined;
  plannedRequest: TaskPlanRequest | undefined;
  onGenerate: (request: TaskPlanRequest) => Promise<void>;
  onStart: (task: TaskSpec) => Promise<void>;
  isPlanning: boolean;
  isStarting: boolean;
  planningError: string | null;
  startError: string | null;
}

export function AgentPlannerCard({
  providers,
  providerError,
  plan,
  plannedRequest,
  onGenerate,
  onStart,
  isPlanning,
  isStarting,
  planningError,
  startError,
}: AgentPlannerCardProps) {
  const [selectedProviderId, setSelectedProviderId] =
    useState<PlannerProviderId>();
  const [requestedBy, setRequestedBy] = useState("demo-user");
  const [prompt, setPrompt] = useState(examplePrompt);
  const providerOptions = providers ?? [];
  const selectedProvider =
    providerOptions.find(
      (provider) => provider.id === selectedProviderId && provider.enabled,
    ) ?? providerOptions.find((provider) => provider.enabled);
  const planMatchesInput = Boolean(
    plan &&
      !isPlanning &&
      plannedRequest?.provider === selectedProvider?.id &&
      plannedRequest?.prompt === prompt &&
      plannedRequest.requestedBy === requestedBy,
  );

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProvider) return;
    try {
      await onGenerate({
        provider: selectedProvider.id,
        prompt,
        requestedBy,
      });
    } catch {
      // React Query exposes the mutation error through `planningError`.
    }
  }

  async function handleStart() {
    if (!plan) return;
    try {
      await onStart(plan.task);
    } catch {
      // React Query exposes the mutation error through `startError`.
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <WandSparkles className="size-4" aria-hidden="true" />
          </div>
          <Badge variant="outline" className="font-mono text-[0.65rem]">
            MASTRA
          </Badge>
        </div>
        <CardTitle>Agent planner</CardTitle>
        <CardDescription>
          Convert a work goal into one validated TaskSpec. Planning never moves
          the desk.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form className="space-y-4" onSubmit={handleGenerate}>
          <div className="space-y-2">
            <Label htmlFor="agent-provider">Provider</Label>
            <select
              id="agent-provider"
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
              value={selectedProvider?.id ?? ""}
              onChange={(event) =>
                setSelectedProviderId(
                  event.target.value === "openai" ? "openai" : "deepseek",
                )
              }
              disabled={!providers}
            >
              {!providers && (
                <option value="">
                  {providerError
                    ? "Provider status unavailable"
                    : "Loading providers…"}
                </option>
              )}
              {providers && !selectedProvider && (
                <option value="">No provider configured</option>
              )}
              {providerOptions.map((provider) => (
                <option
                  key={provider.id}
                  value={provider.id}
                  disabled={!provider.enabled}
                >
                  {provider.name} · {provider.model}
                  {provider.enabled ? "" : " · key missing"}
                </option>
              ))}
            </select>
          </div>
          {providerError && (
            <Alert variant="destructive">
              <AlertTitle>Provider status unavailable</AlertTitle>
              <AlertDescription>{providerError}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="agent-requested-by">Requested by</Label>
            <Input
              id="agent-requested-by"
              value={requestedBy}
              onChange={(event) => setRequestedBy(event.target.value)}
              required
              autoComplete="username"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-goal">Workstation goal</Label>
            <Textarea
              id="agent-goal"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              minLength={1}
              maxLength={2_000}
              rows={5}
              required
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={!selectedProvider || isPlanning || isStarting}
          >
            {isPlanning ? "Generating plan…" : "Generate safe plan"}
            {!isPlanning && <WandSparkles data-icon="inline-end" />}
          </Button>
        </form>

        {planningError && (
          <Alert variant="destructive">
            <AlertTitle>Plan not generated</AlertTitle>
            <AlertDescription>{planningError}</AlertDescription>
          </Alert>
        )}

        {plan && planMatchesInput && (
          <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
            <Task>
              <TaskTrigger title="Generated TaskSpec" />
              <TaskContent>
                <TaskItem className="font-mono text-foreground">
                  desk.move_to_height ·{" "}
                  {plan.task.steps[0].action.input.heightMm}
                  mm
                </TaskItem>
                <TaskItem>
                  Focus duration: {plan.task.constraints.durationMinutes}{" "}
                  minutes
                </TaskItem>
                <TaskItem>
                  Interruptions: {plan.task.constraints.interruptionPolicy}
                </TaskItem>
                {[...new Set(plan.task.assumptions)].map((assumption) => (
                  <TaskItem key={assumption}>Assumes: {assumption}</TaskItem>
                ))}
              </TaskContent>
            </Task>
            <div className="flex items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
              <span className="font-mono">{plan.planner.model}</span>
              <span className="flex items-center gap-1 text-status-warn">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                approval follows
              </span>
            </div>
            {startError && (
              <Alert variant="destructive">
                <AlertTitle>Task not started</AlertTitle>
                <AlertDescription>{startError}</AlertDescription>
              </Alert>
            )}
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={isPlanning || isStarting}
              onClick={() => void handleStart()}
            >
              {isStarting ? "Creating run…" : "Confirm and create run"}
              {!isStarting && <ArrowRight data-icon="inline-end" />}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
