// @vitest-environment jsdom

import type {
  PlannerProvider,
  TaskPlanResponse,
  TaskRunView,
} from "@ergopilot/contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { AgentPlannerCard } from "./agent-planner-card";

const providers: PlannerProvider[] = [
  {
    id: "openai",
    name: "OpenAI",
    model: "openai/gpt-5.5",
    enabled: false,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    model: "deepseek/deepseek-v4-flash",
    enabled: true,
  },
];

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
  planner: {
    framework: "mastra",
    provider: "deepseek",
    model: "deepseek/deepseek-v4-flash",
  },
};

const chairPlan: TaskPlanResponse = {
  task: {
    schemaVersion: 1,
    taskId: "task-agent-chair-ui-1",
    goal: "adjust_seated_support",
    requestedBy: "demo-user",
    constraints: {
      durationMinutes: 30,
      interruptionPolicy: "normal",
    },
    assumptions: ["The user is seated"],
    steps: [
      {
        stepId: "chair-1",
        action: {
          type: "chair.set_lumbar_support",
          input: { levelPercent: 65 },
        },
      },
    ],
  },
  planner: plan.planner,
};

const awaitingRun: TaskRunView = {
  runId: "run-agent-chat-1",
  taskId: plan.task.taskId,
  task: plan.task,
  status: "awaiting_approval",
  suspensionReason: null,
  approval: {
    approvalId: "approval-agent-chat-1",
    expiresAtMs: 61_000,
    status: "pending",
    approvedBy: null,
    approvedAtMs: null,
  },
  command: null,
  commandEvents: [],
  deskMotionProgress: [],
  events: [
    { sequence: 1, eventType: "run_started", atMs: 1_000 },
    { sequence: 2, eventType: "approval_required", atMs: 1_000 },
  ],
  policyDecision: {
    outcome: "require_approval",
    ruleIds: ["desk.motion.requires_approval"],
    reasonCode: null,
  },
};

const completedRun: TaskRunView = {
  ...awaitingRun,
  status: "completed",
  approval: awaitingRun.approval && {
    ...awaitingRun.approval,
    status: "approved",
    approvedBy: "demo-user",
    approvedAtMs: 2_000,
  },
};

const awaitingChairRun: TaskRunView = {
  ...awaitingRun,
  runId: "run-agent-chair-chat-1",
  taskId: chairPlan.task.taskId,
  task: chairPlan.task,
  approval: awaitingRun.approval && {
    ...awaitingRun.approval,
    approvalId: "approval-agent-chair-chat-1",
  },
  policyDecision: {
    outcome: "require_approval",
    ruleIds: ["chair.lumbar.requires_approval"],
    reasonCode: null,
  },
};

const executingRun: TaskRunView = {
  ...awaitingRun,
  status: "executing",
  deskMotionProgress: [
    {
      sequence: 4,
      commandId: "command-run-agent-chat-1",
      progressPercent: 30,
      deskHeightMm: 741,
      atMs: 1_400,
    },
  ],
};

const defaultProps = {
  providers,
  run: undefined,
  onGenerate: vi.fn(async () => plan),
  onStart: vi.fn(async () => awaitingRun),
  onApprove: vi.fn(async () => completedRun),
  onCancel: vi.fn(async () => awaitingRun),
  isPlanning: false,
  isStarting: false,
  isActing: false,
  planningError: null,
  actionError: null,
} satisfies ComponentProps<typeof AgentPlannerCard>;

function renderPlanner(
  overrides: Partial<ComponentProps<typeof AgentPlannerCard>> = {},
) {
  return render(<AgentPlannerCard {...defaultProps} {...overrides} />);
}

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterAll(() => vi.unstubAllGlobals());

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AgentPlannerCard", () => {
  it("presents planning as a conversation", () => {
    renderPlanner();

    expect(screen.getByRole("log")).toBeTruthy();
    expect(
      screen.getByPlaceholderText("Describe your workstation goal…"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
  });

  it("shows missing-key providers as disabled and selects an enabled provider", () => {
    renderPlanner();

    const providerSelect = screen.getByLabelText(
      "Provider",
    ) as HTMLSelectElement;
    const openaiOption = screen.getByRole("option", {
      name: "OpenAI · openai/gpt-5.5 · key missing",
    }) as HTMLOptionElement;

    expect(providerSelect.value).toBe("deepseek");
    expect(openaiOption.disabled).toBe(true);
  });

  it("disables chat submission when no provider key is configured", () => {
    renderPlanner({
      providers: providers.map((provider) => ({
        ...provider,
        enabled: false,
      })),
    });

    expect(
      (screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByDisplayValue("No provider configured")).toBeTruthy();
  });

  it("turns natural language into a plan without starting a run", async () => {
    const onGenerate = vi.fn(async () => plan);
    const onStart = vi.fn(async () => awaitingRun);
    renderPlanner({ onGenerate, onStart });

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(onGenerate).toHaveBeenCalledOnce());
    expect(onGenerate).toHaveBeenCalledWith({
      provider: "deepseek",
      prompt:
        "I want to stand and focus for 45 minutes. Set the desk to 790 mm and only interrupt me for critical issues.",
      requestedBy: "demo-user",
    });
    expect(
      await screen.findByRole("button", { name: "Create protected run" }),
    ).toBeTruthy();
    expect(screen.getByText("desk.move_to_height · 790 mm")).toBeTruthy();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("presents a chair plan and its exact approval scope", async () => {
    const onGenerate = vi.fn(async () => chairPlan);
    const onStart = vi.fn(async () => awaitingChairRun);
    const view = renderPlanner({ onGenerate, onStart });

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(
      await screen.findByText("chair.set_lumbar_support · 65%"),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Create protected run" }),
    );
    await waitFor(() => expect(onStart).toHaveBeenCalledWith(chairPlan.task));

    view.rerender(
      <AgentPlannerCard
        {...defaultProps}
        run={awaitingChairRun}
        onGenerate={onGenerate}
        onStart={onStart}
      />,
    );

    expect(
      await screen.findByText("Device action · chair.set_lumbar_support"),
    ).toBeTruthy();
    expect(screen.getByText(/lumbar support to/).textContent).toContain("65%");
  });

  it("keeps planning failures attached to their original chat turns", async () => {
    const failures = [
      new Error("First planning request failed"),
      new Error("Second planning request failed"),
    ];
    const onGenerate = vi.fn(async () => {
      throw failures.shift() ?? new Error("Unexpected planning request");
    });
    renderPlanner({ onGenerate });

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(
      await screen.findByText("First planning request failed"),
    ).toBeTruthy();

    fireEvent.change(
      screen.getByPlaceholderText("Describe your workstation goal…"),
      { target: { value: "Try a second workstation plan" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(
      await screen.findByText("Second planning request failed"),
    ).toBeTruthy();
    expect(screen.getByText("First planning request failed")).toBeTruthy();
  });

  it("keeps device motion behind a second runtime approval", async () => {
    const onStart = vi.fn(async () => awaitingRun);
    const onApprove = vi.fn(async () => completedRun);
    const view = renderPlanner({ onStart, onApprove });

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Create protected run" }),
    );
    await waitFor(() => expect(onStart).toHaveBeenCalledWith(plan.task));

    view.rerender(
      <AgentPlannerCard
        {...defaultProps}
        run={awaitingRun}
        onStart={onStart}
        onApprove={onApprove}
      />,
    );

    const approveButton = await screen.findByRole("button", {
      name: "Approve motion",
    });
    expect(onApprove).not.toHaveBeenCalled();

    fireEvent.click(approveButton);

    expect(onApprove).toHaveBeenCalledWith(awaitingRun);
  });

  it("reports verified completion in the conversation", async () => {
    const view = renderPlanner();

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Create protected run" }),
    );
    view.rerender(<AgentPlannerCard {...defaultProps} run={completedRun} />);

    expect(
      await screen.findByText(
        (_, node) =>
          node?.tagName === "SPAN" &&
          node.textContent === "Approved and verified at 790 mm.",
      ),
    ).toBeTruthy();
  });

  it("shows streamed Rust progress while the approved command executes", async () => {
    const view = renderPlanner();

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Create protected run" }),
    );
    view.rerender(<AgentPlannerCard {...defaultProps} run={executingRun} />);

    expect(await screen.findByText("Desk motion executing")).toBeTruthy();
    expect(screen.getByText("30% · 741 mm")).toBeTruthy();
  });
});
