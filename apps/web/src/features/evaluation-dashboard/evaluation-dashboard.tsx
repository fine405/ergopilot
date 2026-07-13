import type { PlannerEvaluationReport } from "@ergopilot/contracts";
import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import {
  Activity,
  CheckCircle2,
  Clock3,
  GitCommitHorizontal,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { controlPlane } from "@/lib/control-plane";

export function EvaluationDashboard() {
  const hydrated = useHydrated();
  const query = useQuery({
    queryKey: ["planner-evaluations"],
    queryFn: () => controlPlane.plannerEvaluations(),
    enabled: hydrated,
    retry: false,
  });
  const reports = query.data?.reports ?? [];
  const latest =
    reports.find((report) => report.suite === "full") ?? reports[0];

  return (
    <main className="mx-auto max-w-[90rem] space-y-6 px-5 py-6 lg:px-8 lg:py-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-primary">
            <Activity className="size-4" aria-hidden="true" />
            <span className="font-mono text-xs tracking-wider uppercase">
              Evidence console
            </span>
          </div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Planner evaluations
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Deterministic scoring artifacts produced by the local planner
            evaluation command. Prompts and credentials are never published.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw
            className={query.isFetching ? "animate-spin" : undefined}
            aria-hidden="true"
          />
          Refresh evidence
        </Button>
      </div>

      {query.isLoading ? (
        <Card>
          <CardHeader>
            <CardTitle>Loading evaluation evidence</CardTitle>
            <CardDescription>
              Validating published and local report artifacts.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : query.error ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Evaluation evidence unavailable</CardTitle>
            <CardDescription>{errorMessage(query.error)}</CardDescription>
          </CardHeader>
        </Card>
      ) : latest ? (
        <EvaluationEvidence latest={latest} reports={reports} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No evaluation reports found</CardTitle>
            <CardDescription>
              Run the explicit planner evaluation, then refresh this page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs">
              pnpm eval:planner deepseek full
            </code>
          </CardContent>
        </Card>
      )}
    </main>
  );
}

function EvaluationEvidence({
  latest,
  reports,
}: {
  latest: PlannerEvaluationReport;
  reports: readonly PlannerEvaluationReport[];
}) {
  const failedCases = latest.results.filter((result) => !result.passed);
  return (
    <>
      <section
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Latest evaluation metrics"
      >
        <MetricCard
          label="Pass rate"
          value={`${(latest.passRate * 100).toFixed(1)}%`}
          detail={`${latest.suite} suite`}
          icon={ShieldCheck}
        />
        <MetricCard
          label="Passed cases"
          value={`${latest.passedCases} / ${latest.totalCases}`}
          detail="deterministically scored"
          icon={CheckCircle2}
        />
        <MetricCard
          label="p50 latency"
          value={`${latest.latencyMs.p50.toLocaleString("en-US")} ms`}
          detail="complete planner call"
          icon={Clock3}
        />
        <MetricCard
          label="p95 latency"
          value={`${latest.latencyMs.p95.toLocaleString("en-US")} ms`}
          detail="complete planner call"
          icon={Activity}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader className="border-b">
            <CardTitle>Latest baseline provenance</CardTitle>
            <CardDescription>
              Generated {formatTimestamp(latest.generatedAt)}
            </CardDescription>
            <CardAction>
              <Badge
                variant={failedCases.length === 0 ? "default" : "destructive"}
              >
                {failedCases.length === 0 ? "All gates passed" : "Regression"}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <EvidenceField label="Provider" value={latest.provider} />
            <EvidenceField
              label="Model"
              value={latest.model ?? "not recorded"}
            />
            <EvidenceField label="Suite" value={latest.suite} />
            <EvidenceField
              label="Source commit"
              value={latest.sourceCommit ?? "local working tree"}
              icon={<GitCommitHorizontal aria-hidden="true" />}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-5">
          <CardHeader className="border-b">
            <CardTitle>Regression evidence</CardTitle>
            <CardDescription>
              Failed cases and deterministic scorer findings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {failedCases.length === 0 ? (
              <div className="flex items-start gap-3 rounded-lg bg-primary/10 p-4">
                <CheckCircle2
                  className="mt-0.5 size-4 text-primary"
                  aria-hidden="true"
                />
                <p className="text-sm">
                  No failing cases in this report. This proves only the bounded
                  dataset and version shown here.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {failedCases.map((result) => (
                  <li
                    key={result.caseId}
                    className="rounded-lg border border-destructive/30 bg-destructive/5 p-3"
                  >
                    <div className="flex items-center gap-2 font-mono text-xs font-medium">
                      <TriangleAlert
                        className="size-3.5 text-destructive"
                        aria-hidden="true"
                      />
                      {result.caseId}
                    </div>
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {result.failures.map((failure) => (
                        <li key={failure}>{failure}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Experiment history</CardTitle>
          <CardDescription>
            Published and local reports, newest first. Duplicate artifacts are
            collapsed by provider, suite and generation time.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {reports.map((report) => (
            <div
              key={`${report.provider}:${report.suite}:${report.generatedAt}`}
              className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-6"
            >
              <div>
                <div className="font-mono text-xs font-medium">
                  {report.provider} · {report.suite}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatTimestamp(report.generatedAt)}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {report.passedCases}/{report.totalCases} passed
              </div>
              <Badge
                variant={report.passRate === 1 ? "outline" : "destructive"}
              >
                p95 {report.latencyMs.p95.toLocaleString("en-US")} ms
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardAction>
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="font-mono text-2xl font-semibold tracking-tight">
          {value}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function EvidenceField({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-center gap-1.5 font-mono text-xs">
        {icon ? <span className="[&_svg]:size-3.5">{icon}</span> : null}
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown evaluation error";
}
