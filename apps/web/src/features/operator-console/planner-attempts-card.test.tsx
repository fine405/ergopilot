// @vitest-environment jsdom

import type { PlannerAttempt } from "@ergopilot/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlannerAttemptsCard } from "./planner-attempts-card";

const attempts: PlannerAttempt[] = [
  {
    traceId: "plan-success-1",
    provider: "deepseek",
    model: "deepseek/deepseek-v4-flash",
    startedAtMs: 1_000,
    durationMs: 2_860,
    outcome: "succeeded",
    taskId: "task-plan-1",
    errorCode: null,
  },
  {
    traceId: "plan-invalid-1",
    provider: null,
    model: null,
    startedAtMs: 2_000,
    durationMs: 4,
    outcome: "failed",
    taskId: null,
    errorCode: "invalid_request",
  },
  {
    traceId: "plan-timeout-1",
    provider: "deepseek",
    model: "deepseek/deepseek-v4-flash",
    startedAtMs: 3_000,
    durationMs: 10_000,
    outcome: "failed",
    taskId: null,
    errorCode: "generation_timeout",
  },
];

afterEach(cleanup);

describe("PlannerAttemptsCard", () => {
  it("renders attributed successes and unattributed validation failures", () => {
    render(
      <PlannerAttemptsCard
        attempts={attempts}
        isLoading={false}
        error={null}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText("plan-success-1")).toBeTruthy();
    expect(screen.getAllByText("deepseek/deepseek-v4-flash")).toHaveLength(2);
    expect(screen.getByText("task-plan-1")).toBeTruthy();
    expect(screen.getByText("2,860 ms")).toBeTruthy();
    expect(screen.getByText("plan-invalid-1")).toBeTruthy();
    expect(screen.getByText("Unattributed request")).toBeTruthy();
    expect(screen.getByText("invalid_request")).toBeTruthy();
    expect(screen.getByText("generation_timeout")).toBeTruthy();
    expect(screen.getByText("1970-01-01T00:00:01.000Z")).toBeTruthy();
  });

  it("shows an empty state and supports manual refresh", () => {
    const onRefresh = vi.fn();
    render(
      <PlannerAttemptsCard
        attempts={[]}
        isLoading={false}
        error={null}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByText("No planning attempts yet")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh planner attempts" }),
    );
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("shows a retrieval error without inventing trace data", () => {
    render(
      <PlannerAttemptsCard
        attempts={undefined}
        isLoading={false}
        error="Control plane unavailable"
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText("Attempts unavailable")).toBeTruthy();
    expect(screen.getByText("Control plane unavailable")).toBeTruthy();
    expect(screen.queryByText("No planning attempts yet")).toBeNull();
  });

  it("keeps stale attempts visible when a refresh fails", () => {
    render(
      <PlannerAttemptsCard
        attempts={attempts}
        isLoading={false}
        error="Refresh failed"
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText("Showing cached attempts")).toBeTruthy();
    expect(screen.getByText("Refresh failed")).toBeTruthy();
    expect(screen.getByText("plan-success-1")).toBeTruthy();
  });
});
