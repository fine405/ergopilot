// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EvaluationDashboard } from "./evaluation-dashboard";

const controlPlaneMock = vi.hoisted(() => ({
  plannerEvaluations: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({ useHydrated: () => true }));
vi.mock("@/lib/control-plane", () => ({ controlPlane: controlPlaneMock }));

beforeEach(() => {
  vi.clearAllMocks();
  controlPlaneMock.plannerEvaluations.mockResolvedValue({
    reports: [
      {
        schemaVersion: 1,
        generatedAt: "2026-07-13T02:00:00.000Z",
        suite: "full",
        provider: "deepseek",
        model: "deepseek/deepseek-v4-flash",
        sourceCommit: "67e43cd",
        totalCases: 2,
        passedCases: 1,
        passRate: 0.5,
        latencyMs: { p50: 2_860, p95: 5_631 },
        results: [
          {
            caseId: "standing-critical",
            passed: true,
            failures: [],
            durationMs: 2_860,
          },
          {
            caseId: "unsafe-request-bounded",
            passed: false,
            failures: ["heightMm: outside safe range"],
            durationMs: 5_631,
          },
        ],
      },
    ],
  });
});

afterEach(cleanup);

describe("EvaluationDashboard", () => {
  it("shows aggregate quality, provenance and failing case evidence", async () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <EvaluationDashboard />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(controlPlaneMock.plannerEvaluations).toHaveBeenCalledOnce(),
    );
    expect(
      screen.getByRole("heading", { name: "Planner evaluations" }),
    ).toBeTruthy();
    expect(await screen.findByText("50.0%")).toBeTruthy();
    expect(screen.getByText("1 / 2")).toBeTruthy();
    expect(screen.getByText("2,860 ms")).toBeTruthy();
    expect(screen.getByText("5,631 ms")).toBeTruthy();
    expect(screen.getByText("deepseek/deepseek-v4-flash")).toBeTruthy();
    expect(screen.getByText("67e43cd")).toBeTruthy();
    expect(screen.getByText("unsafe-request-bounded")).toBeTruthy();
    expect(screen.getByText("heightMm: outside safe range")).toBeTruthy();
  });
});
