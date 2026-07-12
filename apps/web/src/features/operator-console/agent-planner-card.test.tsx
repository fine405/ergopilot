// @vitest-environment jsdom

import type { TaskPlanResponse } from "@ergopilot/contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentPlannerCard } from "./agent-planner-card";

const plan: TaskPlanResponse = {
  task: {
    schemaVersion: 1,
    taskId: "task-agent-ui-1",
    goal: "prepare_focus_session",
    requestedBy: "demo-user",
    constraints: {
      durationMinutes: 45,
      interruptionPolicy: "critical-only",
    },
    assumptions: ["Desk movement area is clear"],
    steps: [
      {
        stepId: "desk-1",
        action: {
          type: "desk.move_to_height",
          input: { heightMm: 790 },
        },
      },
    ],
  },
  planner: { framework: "mastra", model: "openai/gpt-5.5" },
};

afterEach(cleanup);

describe("AgentPlannerCard", () => {
  it("submits natural language for planning without starting a task", async () => {
    const onGenerate = vi.fn(async () => undefined);
    const onStart = vi.fn(async () => undefined);
    render(
      <AgentPlannerCard
        plan={undefined}
        plannedRequest={undefined}
        onGenerate={onGenerate}
        onStart={onStart}
        isPlanning={false}
        isStarting={false}
        planningError={null}
        startError={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate safe plan" }));

    await waitFor(() => expect(onGenerate).toHaveBeenCalledOnce());
    expect(onGenerate).toHaveBeenCalledWith({
      prompt:
        "I want to stand and focus for 45 minutes. Set the desk to 790 mm and only interrupt me for critical issues.",
      requestedBy: "demo-user",
    });
    expect(onStart).not.toHaveBeenCalled();
  });

  it("requires a second explicit action before starting the generated plan", () => {
    const onStart = vi.fn(async () => undefined);
    render(
      <AgentPlannerCard
        plan={plan}
        plannedRequest={{
          prompt:
            "I want to stand and focus for 45 minutes. Set the desk to 790 mm and only interrupt me for critical issues.",
          requestedBy: "demo-user",
        }}
        onGenerate={vi.fn(async () => undefined)}
        onStart={onStart}
        isPlanning={false}
        isStarting={false}
        planningError={null}
        startError={null}
      />,
    );

    expect(screen.getByText("desk.move_to_height · 790mm")).toBeTruthy();
    expect(screen.getByText("Interruptions: critical-only")).toBeTruthy();
    expect(onStart).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Confirm and create run" }),
    );

    expect(onStart).toHaveBeenCalledWith(plan.task);
  });

  it("hides confirmation when the request changes after generation", () => {
    render(
      <AgentPlannerCard
        plan={plan}
        plannedRequest={{
          prompt:
            "I want to stand and focus for 45 minutes. Set the desk to 790 mm and only interrupt me for critical issues.",
          requestedBy: "demo-user",
        }}
        onGenerate={vi.fn(async () => undefined)}
        onStart={vi.fn(async () => undefined)}
        isPlanning={false}
        isStarting={false}
        planningError={null}
        startError={null}
      />,
    );

    fireEvent.change(screen.getByLabelText("Workstation goal"), {
      target: { value: "Use a different height" },
    });

    expect(
      screen.queryByRole("button", { name: "Confirm and create run" }),
    ).toBeNull();
  });

  it("hides the previous plan while a new request is pending", () => {
    render(
      <AgentPlannerCard
        plan={plan}
        plannedRequest={{
          prompt:
            "I want to stand and focus for 45 minutes. Set the desk to 790 mm and only interrupt me for critical issues.",
          requestedBy: "demo-user",
        }}
        onGenerate={vi.fn(async () => undefined)}
        onStart={vi.fn(async () => undefined)}
        isPlanning
        isStarting={false}
        planningError={null}
        startError={null}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Confirm and create run" }),
    ).toBeNull();
  });
});
