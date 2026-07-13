import type {
  TaskPlanRequest,
  TaskRunView,
  TaskSpec,
} from "@ergopilot/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { Boxes, Radio } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { controlPlane } from "@/lib/control-plane";

import { AgentPlannerCard } from "./agent-planner-card";
import { PlannerAttemptsCard } from "./planner-attempts-card";
import { RunOverview } from "./run-overview";
import { StationCard } from "./station-card";
import { TaskComposer } from "./task-composer";

interface OperatorConsoleProps {
  runId: string | undefined;
  onRunIdChange: (runId: string) => void | Promise<void>;
}

export function OperatorConsole({
  runId,
  onRunIdChange,
}: OperatorConsoleProps) {
  const hydrated = useHydrated();
  const queryClient = useQueryClient();
  const runQuery = useQuery({
    queryKey: ["task-run", runId],
    queryFn: () => controlPlane.inspectTask(requireRunId(runId)),
    enabled: hydrated && Boolean(runId),
    retry: false,
  });
  const stationQuery = useQuery({
    queryKey: ["station-snapshot"],
    queryFn: () => controlPlane.stationSnapshot(),
    enabled: hydrated,
    retry: false,
  });
  const plannerProvidersQuery = useQuery({
    queryKey: ["planner-providers"],
    queryFn: () => controlPlane.plannerProviders(),
    enabled: hydrated,
    retry: false,
  });
  const plannerAttemptsQuery = useQuery({
    queryKey: ["planner-attempts"],
    queryFn: () => controlPlane.plannerAttempts(),
    enabled: hydrated,
    retry: false,
  });

  const planMutation = useMutation({
    mutationFn: (request: TaskPlanRequest) => controlPlane.planTask(request),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["planner-attempts"] });
    },
  });
  const startMutation = useMutation({
    mutationFn: (task: TaskSpec) => controlPlane.startTask(task),
    onSuccess: async (run) => {
      queryClient.setQueryData(["task-run", run.runId], run);
      await onRunIdChange(run.runId);
      await queryClient.invalidateQueries({ queryKey: ["station-snapshot"] });
    },
  });
  const approveMutation = useMutation({
    mutationFn: (run: TaskRunView) =>
      controlPlane.approveTask(run.runId, run.task.requestedBy),
    onSuccess: (run) => {
      queryClient.setQueryData(["task-run", run.runId], run);
    },
    onSettled: async (_data, _error, run) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["task-run", run.runId],
        }),
        queryClient.invalidateQueries({ queryKey: ["station-snapshot"] }),
      ]);
    },
  });
  const approveWithAckLossMutation = useMutation({
    mutationFn: (run: TaskRunView) =>
      controlPlane.demoApproveTaskWithAckLoss(run.runId, run.task.requestedBy),
    onSuccess: (run) => {
      queryClient.setQueryData(["task-run", run.runId], run);
    },
    onSettled: async (_data, _error, run) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["task-run", run.runId],
        }),
        queryClient.invalidateQueries({ queryKey: ["station-snapshot"] }),
      ]);
    },
  });
  const approveWithDeviceOfflineMutation = useMutation({
    mutationFn: (run: TaskRunView) =>
      controlPlane.demoApproveTaskWithDeviceOffline(
        run.runId,
        run.task.requestedBy,
      ),
    onSuccess: (run) => {
      queryClient.setQueryData(["task-run", run.runId], run);
    },
    onSettled: async (_data, _error, run) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["task-run", run.runId],
        }),
        queryClient.invalidateQueries({ queryKey: ["station-snapshot"] }),
      ]);
    },
  });
  const approveWithDeviceUnavailableBeforeDispatchMutation = useMutation({
    mutationFn: (run: TaskRunView) =>
      controlPlane.demoApproveTaskWithDeviceUnavailableBeforeDispatch(
        run.runId,
        run.task.requestedBy,
      ),
    onSuccess: (run) => {
      queryClient.setQueryData(["task-run", run.runId], run);
    },
    onSettled: async (_data, _error, run) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["task-run", run.runId],
        }),
        queryClient.invalidateQueries({ queryKey: ["station-snapshot"] }),
      ]);
    },
  });
  const reconcileMutation = useMutation({
    mutationFn: (run: TaskRunView) => controlPlane.reconcileTask(run.runId),
    onSuccess: (run) => {
      queryClient.setQueryData(["task-run", run.runId], run);
    },
    onSettled: async (_data, _error, run) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["task-run", run.runId],
        }),
        queryClient.invalidateQueries({ queryKey: ["station-snapshot"] }),
      ]);
    },
  });
  const resumeMutation = useMutation({
    mutationFn: (run: TaskRunView) => controlPlane.resumeTask(run.runId),
    onSuccess: (run) => {
      queryClient.setQueryData(["task-run", run.runId], run);
    },
    onSettled: async (_data, _error, run) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["task-run", run.runId],
        }),
        queryClient.invalidateQueries({ queryKey: ["station-snapshot"] }),
      ]);
    },
  });

  const actionError =
    errorMessage(startMutation.error) ??
    errorMessage(approveMutation.error) ??
    errorMessage(approveWithAckLossMutation.error) ??
    errorMessage(approveWithDeviceOfflineMutation.error) ??
    errorMessage(approveWithDeviceUnavailableBeforeDispatchMutation.error) ??
    errorMessage(resumeMutation.error) ??
    errorMessage(reconcileMutation.error);
  const isMutating =
    startMutation.isPending ||
    approveMutation.isPending ||
    approveWithAckLossMutation.isPending ||
    approveWithDeviceOfflineMutation.isPending ||
    approveWithDeviceUnavailableBeforeDispatchMutation.isPending ||
    resumeMutation.isPending ||
    reconcileMutation.isPending;

  return (
    <div className="min-h-svh bg-background">
      <header className="border-b bg-background/95">
        <div className="mx-auto flex max-w-[90rem] items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Boxes className="size-4" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tracking-tight">
                  ErgoPilot
                </span>
                <Badge variant="outline" className="font-mono text-[0.65rem]">
                  LOCAL
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Recoverable workstation agent runtime
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Radio
              className={
                stationQuery.data
                  ? "size-3.5 text-status-ok"
                  : "size-3.5 text-muted-foreground"
              }
              aria-hidden="true"
            />
            {stationQuery.data
              ? "Station connected"
              : stationQuery.error
                ? "Station unavailable"
                : "Connecting to station"}
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[90rem] gap-6 px-5 py-6 lg:grid-cols-12 lg:px-8 lg:py-8">
        <aside className="space-y-6 lg:col-span-4 xl:col-span-3">
          <AgentPlannerCard
            providers={plannerProvidersQuery.data?.providers}
            providerError={errorMessage(plannerProvidersQuery.error)}
            plan={planMutation.data}
            plannedRequest={planMutation.variables}
            onGenerate={(request) => {
              planMutation.reset();
              startMutation.reset();
              return planMutation.mutateAsync(request).then(() => undefined);
            }}
            onStart={(task) =>
              startMutation.mutateAsync(task).then(() => undefined)
            }
            isPlanning={planMutation.isPending}
            isStarting={startMutation.isPending}
            planningError={errorMessage(planMutation.error)}
            startError={errorMessage(startMutation.error)}
          />
          <TaskComposer
            onSubmit={(task) =>
              startMutation.mutateAsync(task).then(() => undefined)
            }
            isPending={startMutation.isPending}
            error={errorMessage(startMutation.error)}
          />
          <StationCard
            snapshot={stationQuery.data}
            isLoading={stationQuery.isLoading || stationQuery.isFetching}
            error={errorMessage(stationQuery.error)}
            onRefresh={() => {
              void stationQuery.refetch();
            }}
          />
        </aside>

        <section className="space-y-6 lg:col-span-8 xl:col-span-9">
          <RunOverview
            run={runQuery.data}
            isLoading={Boolean(runId) && runQuery.isLoading}
            error={errorMessage(runQuery.error) ?? actionError}
            isMutating={isMutating}
            onApprove={(run) => approveMutation.mutate(run)}
            onApproveWithAckLoss={(run) =>
              approveWithAckLossMutation.mutate(run)
            }
            onApproveWithDeviceOffline={(run) =>
              approveWithDeviceOfflineMutation.mutate(run)
            }
            onApproveWithDeviceUnavailableBeforeDispatch={(run) =>
              approveWithDeviceUnavailableBeforeDispatchMutation.mutate(run)
            }
            onResume={(run) => resumeMutation.mutate(run)}
            onReconcile={(run) => reconcileMutation.mutate(run)}
          />
          <PlannerAttemptsCard
            attempts={plannerAttemptsQuery.data?.attempts}
            isLoading={
              plannerAttemptsQuery.isLoading || plannerAttemptsQuery.isFetching
            }
            error={errorMessage(plannerAttemptsQuery.error)}
            onRefresh={() => {
              void plannerAttemptsQuery.refetch();
            }}
          />
        </section>
      </main>
    </div>
  );
}

function requireRunId(runId: string | undefined) {
  if (!runId) throw new Error("runId is required");
  return runId;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : null;
}
