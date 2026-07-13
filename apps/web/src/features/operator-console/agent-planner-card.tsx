import type {
  PlannerProvider,
  PlannerProviderId,
  TaskPlanRequest,
  TaskPlanResponse,
  TaskRunView,
  TaskSpec,
} from "@ergopilot/contracts";
import {
  ArrowRight,
  Check,
  LoaderCircle,
  MessageSquare,
  ShieldCheck,
  WandSparkles,
  X,
} from "lucide-react";
import { useRef, useState } from "react";

import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
} from "@/components/ai-elements/confirmation";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
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

const examplePrompt =
  "I want to stand and focus for 45 minutes. Set the desk to 790 mm and only interrupt me for critical issues.";

interface ChatTurn {
  id: number;
  prompt: string;
  status: "planning" | "ready" | "error";
  plan?: TaskPlanResponse;
  planningError: string | null;
  startError: string | null;
}

interface AgentPlannerCardProps {
  providers: PlannerProvider[] | undefined;
  providerError?: string | null;
  run: TaskRunView | undefined;
  onGenerate: (request: TaskPlanRequest) => Promise<TaskPlanResponse>;
  onStart: (task: TaskSpec) => Promise<TaskRunView>;
  onApprove: (run: TaskRunView) => Promise<TaskRunView>;
  onCancel: (run: TaskRunView) => Promise<TaskRunView>;
  isPlanning: boolean;
  isStarting: boolean;
  isActing: boolean;
  planningError: string | null;
  actionError: string | null;
}

function messageFromError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function AgentPlannerCard({
  providers,
  providerError,
  run,
  onGenerate,
  onStart,
  onApprove,
  onCancel,
  isPlanning,
  isStarting,
  isActing,
  planningError,
  actionError,
}: AgentPlannerCardProps) {
  const [selectedProviderId, setSelectedProviderId] =
    useState<PlannerProviderId>();
  const [requestedBy, setRequestedBy] = useState("demo-user");
  const [prompt, setPrompt] = useState(examplePrompt);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [chatRunId, setChatRunId] = useState<string>();
  const [startingTurnId, setStartingTurnId] = useState<number>();
  const nextTurnId = useRef(1);
  const providerOptions = providers ?? [];
  const selectedProvider =
    providerOptions.find(
      (provider) => provider.id === selectedProviderId && provider.enabled,
    ) ?? providerOptions.find((provider) => provider.enabled);
  const chatRun = run?.runId === chatRunId ? run : undefined;

  async function handleGenerate(message: PromptInputMessage) {
    const submittedPrompt = message.text.trim();
    if (!selectedProvider || !submittedPrompt || !requestedBy.trim()) return;

    const turnId = nextTurnId.current;
    nextTurnId.current += 1;
    setTurns((current) => [
      ...current,
      {
        id: turnId,
        prompt: submittedPrompt,
        status: "planning",
        planningError: null,
        startError: null,
      },
    ]);

    try {
      const plan = await onGenerate({
        provider: selectedProvider.id,
        prompt: submittedPrompt,
        requestedBy,
      });
      setTurns((current) =>
        current.map((turn) =>
          turn.id === turnId ? { ...turn, plan, status: "ready" } : turn,
        ),
      );
      setPrompt("");
    } catch (error) {
      setTurns((current) =>
        current.map((turn) =>
          turn.id === turnId
            ? {
                ...turn,
                planningError: messageFromError(error, "Planning failed"),
                status: "error",
              }
            : turn,
        ),
      );
    }
  }

  async function handleStart(turnId: number, plan: TaskPlanResponse) {
    setStartingTurnId(turnId);
    setTurns((current) =>
      current.map((turn) =>
        turn.id === turnId ? { ...turn, startError: null } : turn,
      ),
    );
    try {
      const createdRun = await onStart(plan.task);
      setChatRunId(createdRun.runId);
    } catch (error) {
      setTurns((current) =>
        current.map((turn) =>
          turn.id === turnId
            ? {
                ...turn,
                startError: messageFromError(error, "Task not started"),
              }
            : turn,
        ),
      );
    } finally {
      setStartingTurnId((current) =>
        current === turnId ? undefined : current,
      );
    }
  }

  async function handleApprove(activeRun: TaskRunView) {
    try {
      await onApprove(activeRun);
    } catch {
      // React Query exposes the mutation error through `actionError`.
    }
  }

  async function handleCancel(activeRun: TaskRunView) {
    try {
      await onCancel(activeRun);
    } catch {
      // React Query exposes the mutation error through `actionError`.
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <MessageSquare className="size-4" aria-hidden="true" />
          </div>
          <Badge variant="outline" className="font-mono text-[0.65rem]">
            MASTRA · CHAT
          </Badge>
        </div>
        <CardTitle>Agent control chat</CardTitle>
        <CardDescription>
          Ask for a workstation change. The model plans; policy and approval
          still control motion.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3">
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
        </div>

        {providerError && (
          <Alert variant="destructive">
            <AlertTitle>Provider status unavailable</AlertTitle>
            <AlertDescription>{providerError}</AlertDescription>
          </Alert>
        )}

        <div className="flex h-[34rem] min-h-0 flex-col overflow-hidden rounded-xl border bg-muted/15">
          <Conversation className="min-h-0">
            <ConversationContent className="gap-5 p-3">
              <Message from="assistant">
                <MessageContent>
                  <p>
                    Tell me the desk height and focus session you want. I will
                    produce a typed plan first;{" "}
                    <strong>nothing moves during planning</strong>.
                  </p>
                </MessageContent>
              </Message>

              {turns.map((turn) => (
                <ChatTurnMessage
                  key={turn.id}
                  turn={turn}
                  isStarting={startingTurnId === turn.id}
                  startDisabled={isStarting || startingTurnId !== undefined}
                  onStart={handleStart}
                />
              ))}

              {chatRun && (
                <RunConfirmationMessage
                  run={chatRun}
                  actionError={actionError}
                  isActing={isActing}
                  onApprove={handleApprove}
                  onCancel={handleCancel}
                />
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          <div className="border-t bg-card p-3">
            <PromptInput onSubmit={handleGenerate}>
              <PromptInputTextarea
                name="message"
                value={prompt}
                onChange={(event) => setPrompt(event.currentTarget.value)}
                placeholder="Describe your workstation goal…"
                maxLength={2_000}
                disabled={isPlanning || isStarting || isActing}
              />
              <PromptInputFooter>
                <PromptInputTools>
                  <span className="truncate px-1 font-mono text-[0.65rem] text-muted-foreground">
                    {selectedProvider?.model ?? "No provider configured"}
                  </span>
                </PromptInputTools>
                <PromptInputSubmit
                  status={
                    isPlanning ? "submitted" : planningError ? "error" : "ready"
                  }
                  disabled={
                    !selectedProvider ||
                    !prompt.trim() ||
                    !requestedBy.trim() ||
                    isPlanning ||
                    isStarting ||
                    isActing
                  }
                />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface ChatTurnMessageProps {
  turn: ChatTurn;
  isStarting: boolean;
  startDisabled: boolean;
  onStart: (turnId: number, plan: TaskPlanResponse) => Promise<void>;
}

function ChatTurnMessage({
  turn,
  isStarting,
  startDisabled,
  onStart,
}: ChatTurnMessageProps) {
  return (
    <>
      <Message from="user">
        <MessageContent>
          <p className="whitespace-pre-wrap">{turn.prompt}</p>
        </MessageContent>
      </Message>

      {turn.status === "planning" && (
        <Message from="assistant">
          <MessageContent className="flex-row items-center text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            Validating a typed plan…
          </MessageContent>
        </Message>
      )}

      {turn.status === "error" && (
        <Message from="assistant">
          <MessageContent className="w-full">
            <Alert variant="destructive">
              <AlertTitle>Plan not generated</AlertTitle>
              <AlertDescription>
                {turn.planningError ?? "Planning failed"}
              </AlertDescription>
            </Alert>
          </MessageContent>
        </Message>
      )}

      {turn.status === "ready" && turn.plan && (
        <Message from="assistant">
          <MessageContent className="w-full rounded-lg border bg-card p-3">
            <p className="text-sm">
              I prepared one protected desk motion. Review the typed TaskSpec
              before creating a durable run.
            </p>
            <Task>
              <TaskTrigger title="Generated TaskSpec" />
              <TaskContent>
                <TaskItem className="font-mono text-foreground">
                  desk.move_to_height ·{" "}
                  {turn.plan.task.steps[0].action.input.heightMm}
                  mm
                </TaskItem>
                <TaskItem>
                  Focus duration: {turn.plan.task.constraints.durationMinutes}{" "}
                  minutes
                </TaskItem>
                <TaskItem>
                  Interruptions: {turn.plan.task.constraints.interruptionPolicy}
                </TaskItem>
                {[...new Set(turn.plan.task.assumptions)].map((assumption) => (
                  <TaskItem key={assumption}>
                    <span className="text-sm text-muted-foreground">
                      Assumes: {assumption}
                    </span>
                  </TaskItem>
                ))}
              </TaskContent>
            </Task>
            <div className="flex items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
              <span className="font-mono">{turn.plan.planner.model}</span>
              <span className="flex items-center gap-1 text-status-warn">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                approval follows
              </span>
            </div>
            {turn.startError && (
              <Alert variant="destructive">
                <AlertTitle>Task not started</AlertTitle>
                <AlertDescription>{turn.startError}</AlertDescription>
              </Alert>
            )}
            <Button
              type="button"
              className="w-full"
              disabled={startDisabled}
              onClick={() => {
                if (turn.plan) {
                  void onStart(turn.id, turn.plan);
                }
              }}
            >
              {isStarting ? "Creating run…" : "Create protected run"}
              {!isStarting && <ArrowRight data-icon="inline-end" />}
            </Button>
          </MessageContent>
        </Message>
      )}
    </>
  );
}

interface RunConfirmationMessageProps {
  run: TaskRunView;
  actionError: string | null;
  isActing: boolean;
  onApprove: (run: TaskRunView) => Promise<void>;
  onCancel: (run: TaskRunView) => Promise<void>;
}

function RunConfirmationMessage({
  run,
  actionError,
  isActing,
  onApprove,
  onCancel,
}: RunConfirmationMessageProps) {
  const approvalId = run.approval?.approvalId;
  const targetHeightMm = run.task.steps[0].action.input.heightMm;

  if (
    run.status === "awaiting_approval" &&
    run.approval?.status === "pending" &&
    approvalId
  ) {
    return (
      <Message from="assistant">
        <MessageContent className="w-full">
          <Confirmation
            approval={{ id: approvalId }}
            state="approval-requested"
          >
            <ConfirmationTitle>
              Device action · desk.move_to_height
            </ConfirmationTitle>
            <ConfirmationRequest>
              <p className="text-sm">
                The runtime is ready to move the simulated desk to{" "}
                <span className="font-mono">{targetHeightMm} mm</span>. This
                approval is scoped to one run and one exact command.
              </p>
            </ConfirmationRequest>
            <ConfirmationActions className="w-full justify-stretch">
              <ConfirmationAction
                variant="outline"
                className="flex-1"
                disabled={isActing}
                onClick={() => void onCancel(run)}
              >
                Deny
              </ConfirmationAction>
              <ConfirmationAction
                className="flex-1"
                disabled={isActing}
                onClick={() => void onApprove(run)}
              >
                {isActing ? "Working…" : "Approve motion"}
              </ConfirmationAction>
            </ConfirmationActions>
          </Confirmation>
          {actionError && (
            <Alert variant="destructive">
              <AlertTitle>Runtime action failed</AlertTitle>
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          )}
        </MessageContent>
      </Message>
    );
  }

  if (run.status === "completed" && approvalId) {
    return (
      <Message from="assistant">
        <MessageContent className="w-full">
          <Confirmation
            approval={{ id: approvalId, approved: true }}
            state="output-available"
          >
            <ConfirmationAccepted>
              <div className="flex items-start gap-2 text-sm">
                <Check
                  className="mt-0.5 size-4 shrink-0 text-status-ok"
                  aria-hidden="true"
                />
                <span>
                  Approved and verified at{" "}
                  <span className="font-mono">{targetHeightMm} mm</span>.
                </span>
              </div>
            </ConfirmationAccepted>
          </Confirmation>
        </MessageContent>
      </Message>
    );
  }

  if (run.status === "cancelled" && approvalId) {
    return (
      <Message from="assistant">
        <MessageContent className="w-full">
          <Confirmation
            approval={{ id: approvalId, approved: false }}
            state="output-denied"
          >
            <ConfirmationRejected>
              <div className="flex items-start gap-2 text-sm">
                <X
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span>Motion denied. No device command was dispatched.</span>
              </div>
            </ConfirmationRejected>
          </Confirmation>
        </MessageContent>
      </Message>
    );
  }

  return (
    <Message from="assistant">
      <MessageContent className="w-full">
        <Alert variant={run.status === "failed" ? "destructive" : "default"}>
          <WandSparkles />
          <AlertTitle>Runtime status · {run.status}</AlertTitle>
          <AlertDescription>
            Inspect the task run timeline for the authoritative state and next
            recovery action.
          </AlertDescription>
        </Alert>
      </MessageContent>
    </Message>
  );
}
