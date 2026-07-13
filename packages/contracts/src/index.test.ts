import { describe, expect, it } from "vitest";

import {
  capabilityCatalogResponseSchema,
  plannerAttemptsResponseSchema,
  plannerEvaluationsResponseSchema,
  plannerProvidersResponseSchema,
  taskEventSchema,
  taskPlanDraftSchema,
  taskPlanRequestSchema,
  taskPlanResponseSchema,
  taskRunViewSchema,
  taskSpecSchema,
  verifiedOutcomeSchema,
  workstationCapabilityCatalog,
  workstationSnapshotSchema,
} from "./index";

describe("Planner evaluation evidence contract", () => {
  const report = {
    schemaVersion: 1,
    generatedAt: "2026-07-13T01:24:01.271Z",
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
  } as const;

  it("accepts a versioned report whose aggregate metrics match its cases", () => {
    expect(
      plannerEvaluationsResponseSchema.parse({ reports: [report] }).reports[0],
    ).toEqual(report);
  });

  it("rejects aggregate metrics that contradict the case evidence", () => {
    expect(
      plannerEvaluationsResponseSchema.safeParse({
        reports: [{ ...report, passedCases: 2, passRate: 1 }],
      }).success,
    ).toBe(false);
  });
});

describe("Device capability catalog", () => {
  it("publishes the desk motion envelope and mandatory approval boundary", () => {
    const catalog = capabilityCatalogResponseSchema.parse(
      workstationCapabilityCatalog,
    );

    expect(catalog).toEqual({
      schemaVersion: 1,
      capabilities: [
        expect.objectContaining({
          id: "desk.move_to_height",
          mode: "action",
          risk: "motion",
          cancelable: false,
          approval: { required: true },
          inputSchema: expect.objectContaining({
            required: ["heightMm"],
            properties: {
              heightMm: {
                type: "integer",
                minimum: 620,
                maximum: 1_280,
              },
            },
          }),
          verification: {
            strategy: "read_after_write",
            observedField: "deskHeightMm",
          },
        }),
        expect.objectContaining({
          id: "chair.set_lumbar_support",
          mode: "action",
          risk: "motion",
          cancelable: false,
          approval: { required: true },
          inputSchema: expect.objectContaining({
            required: ["levelPercent"],
            properties: {
              levelPercent: {
                type: "integer",
                minimum: 0,
                maximum: 100,
              },
            },
          }),
          verification: {
            strategy: "read_after_write",
            observedField: "lumbarSupportPercent",
          },
        }),
      ],
    });
  });
});

describe("TaskSpec contract", () => {
  it("matches the versioned planner-to-runtime payload", () => {
    const task = taskSpecSchema.parse({
      schemaVersion: 1,
      taskId: "task-web-1",
      goal: "prepare_focus_session",
      requestedBy: "user-1",
      constraints: { durationMinutes: 45, interruptionPolicy: "critical-only" },
      assumptions: ["desk area is clear"],
      steps: [
        {
          stepId: "desk-1",
          action: {
            type: "desk.move_to_height",
            input: { heightMm: 780 },
          },
        },
      ],
    });

    expect(task.steps[0]?.action).toEqual({
      type: "desk.move_to_height",
      input: { heightMm: 780 },
    });
  });

  it("rejects an unversioned or empty plan before it reaches Rust", () => {
    expect(() =>
      taskSpecSchema.parse({
        taskId: "task-web-invalid",
        goal: "prepare_focus_session",
        requestedBy: "user-1",
        constraints: {},
        assumptions: [],
        steps: [],
      }),
    ).toThrow();
  });

  it("matches the smart-chair lumbar action accepted by Rust", () => {
    const task = taskSpecSchema.parse({
      schemaVersion: 1,
      taskId: "task-chair-1",
      goal: "adjust_seated_support",
      requestedBy: "user-1",
      constraints: {},
      assumptions: [],
      steps: [
        {
          stepId: "chair-1",
          action: {
            type: "chair.set_lumbar_support",
            input: { levelPercent: 65 },
          },
        },
      ],
    });

    expect(task.steps[0]?.action).toEqual({
      type: "chair.set_lumbar_support",
      input: { levelPercent: 65 },
    });
  });

  it("accepts one protected desk-then-lumbar profile and rejects reversed order", () => {
    const profile = {
      schemaVersion: 1,
      taskId: "task-profile-1",
      goal: "restore_profile",
      requestedBy: "user-1",
      constraints: {},
      assumptions: ["Desk movement area is clear"],
      steps: [
        {
          stepId: "desk-1",
          action: {
            type: "desk.move_to_height",
            input: { heightMm: 780 },
          },
        },
        {
          stepId: "chair-1",
          action: {
            type: "chair.set_lumbar_support",
            input: { levelPercent: 65 },
          },
        },
      ],
    };

    expect(taskSpecSchema.parse(profile).steps).toHaveLength(2);
    expect(
      taskSpecSchema.safeParse({ ...profile, steps: [profile.steps[0]] })
        .success,
    ).toBe(false);
    expect(
      taskSpecSchema.safeParse({
        ...profile,
        steps: [...profile.steps].reverse(),
      }).success,
    ).toBe(false);
  });

  it("upgrades schema-v1 station observations with default lumbar support", () => {
    expect(
      workstationSnapshotSchema.parse({
        schemaVersion: 1,
        stationId: "station-legacy-1",
        stateVersion: 4,
        observedAtMs: 1_000,
        deskHeightMm: 720,
        movementCount: 2,
      }).lumbarSupportPercent,
    ).toBe(35);
    expect(
      verifiedOutcomeSchema.parse({
        stateVersion: 4,
        deskHeightMm: 720,
        verifiedAtMs: 1_000,
      }).lumbarSupportPercent,
    ).toBe(35);
  });

  it("rejects values that exceed the Rust and process boundaries", () => {
    const valid = {
      schemaVersion: 1,
      taskId: "task-web-bounds",
      goal: "prepare_focus_session",
      requestedBy: "user-1",
      constraints: {},
      assumptions: [],
      steps: [
        {
          stepId: "desk-1",
          action: {
            type: "desk.move_to_height",
            input: { heightMm: 780 },
          },
        },
      ],
    };

    expect(
      taskSpecSchema.safeParse({
        ...valid,
        constraints: { durationMinutes: 65_536 },
      }).success,
    ).toBe(false);
    expect(
      taskSpecSchema.safeParse({
        ...valid,
        assumptions: Array.from({ length: 17 }, () => "bounded"),
      }).success,
    ).toBe(false);
  });
});

describe("Task planning contract", () => {
  it("accepts privacy-safe planner attempt evidence", () => {
    expect(
      plannerAttemptsResponseSchema.parse({
        attempts: [
          {
            traceId: "plan-trace-1",
            provider: "deepseek",
            model: "deepseek/deepseek-v4-flash",
            startedAtMs: 1_000,
            durationMs: 25,
            outcome: "succeeded",
            taskId: "task-agent-1",
            errorCode: null,
          },
        ],
      }).attempts[0],
    ).toEqual({
      traceId: "plan-trace-1",
      provider: "deepseek",
      model: "deepseek/deepseek-v4-flash",
      startedAtMs: 1_000,
      durationMs: 25,
      outcome: "succeeded",
      taskId: "task-agent-1",
      errorCode: null,
    });
  });

  it("rejects contradictory planner attempt evidence", () => {
    expect(
      plannerAttemptsResponseSchema.safeParse({
        attempts: [
          {
            traceId: "plan-trace-invalid",
            provider: "deepseek",
            model: "deepseek/deepseek-v4-flash",
            startedAtMs: 1_000,
            durationMs: 25,
            outcome: "succeeded",
            taskId: null,
            errorCode: "invalid_plan",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts a privacy-safe invalid-request attempt without provider attribution", () => {
    expect(
      plannerAttemptsResponseSchema.parse({
        attempts: [
          {
            traceId: "plan-trace-invalid-request",
            provider: null,
            model: null,
            startedAtMs: 1_000,
            durationMs: 5,
            outcome: "failed",
            taskId: null,
            errorCode: "invalid_request",
          },
        ],
      }).attempts[0],
    ).toEqual({
      traceId: "plan-trace-invalid-request",
      provider: null,
      model: null,
      startedAtMs: 1_000,
      durationMs: 5,
      outcome: "failed",
      taskId: null,
      errorCode: "invalid_request",
    });
  });

  it("accepts an unattributed payload-limit attempt", () => {
    expect(
      plannerAttemptsResponseSchema.safeParse({
        attempts: [
          {
            traceId: "plan-trace-payload-limit",
            provider: null,
            model: null,
            startedAtMs: 1_000,
            durationMs: 5,
            outcome: "failed",
            taskId: null,
            errorCode: "payload_too_large",
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("describes configured and disabled planner providers", () => {
    expect(
      plannerProvidersResponseSchema.parse({
        providers: [
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
        ],
      }),
    ).toEqual({
      providers: [
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
      ],
    });
  });

  it("accepts a bounded natural-language request and generated plan", () => {
    expect(
      taskPlanRequestSchema.parse({
        provider: "deepseek",
        prompt: "Raise the desk for a 45 minute focus session",
        requestedBy: "user-1",
      }),
    ).toEqual({
      provider: "deepseek",
      prompt: "Raise the desk for a 45 minute focus session",
      requestedBy: "user-1",
    });
    expect(
      taskPlanDraftSchema.parse({
        action: "desk.move_to_height",
        targetHeightMm: 780,
        durationMinutes: 45,
        interruptionPolicy: "critical-only",
        assumptions: ["Desk movement area is clear"],
      }),
    ).toEqual({
      action: "desk.move_to_height",
      targetHeightMm: 780,
      durationMinutes: 45,
      interruptionPolicy: "critical-only",
      assumptions: ["Desk movement area is clear"],
    });

    expect(
      taskPlanDraftSchema.parse({
        action: "chair.set_lumbar_support",
        lumbarSupportPercent: 65,
        durationMinutes: 30,
        interruptionPolicy: "normal",
        assumptions: ["The user is seated"],
      }),
    ).toEqual({
      action: "chair.set_lumbar_support",
      lumbarSupportPercent: 65,
      durationMinutes: 30,
      interruptionPolicy: "normal",
      assumptions: ["The user is seated"],
    });

    expect(
      taskPlanDraftSchema.parse({
        action: "workstation.restore_profile",
        targetHeightMm: 780,
        lumbarSupportPercent: 65,
        durationMinutes: 45,
        interruptionPolicy: "critical-only",
        assumptions: ["Desk movement area is clear"],
      }),
    ).toEqual({
      action: "workstation.restore_profile",
      targetHeightMm: 780,
      lumbarSupportPercent: 65,
      durationMinutes: 45,
      interruptionPolicy: "critical-only",
      assumptions: ["Desk movement area is clear"],
    });
  });

  it("rejects oversized prompts and unsafe generated desk heights", () => {
    expect(
      taskPlanRequestSchema.safeParse({
        prompt: "x".repeat(2_001),
        requestedBy: "user-1",
      }).success,
    ).toBe(false);
    expect(
      taskPlanDraftSchema.safeParse({
        action: "desk.move_to_height",
        targetHeightMm: 1_400,
        durationMinutes: 45,
        interruptionPolicy: "critical-only",
        assumptions: [],
      }).success,
    ).toBe(false);
    expect(
      taskPlanDraftSchema.safeParse({
        action: "chair.set_lumbar_support",
        lumbarSupportPercent: 101,
        durationMinutes: 45,
        interruptionPolicy: "normal",
        assumptions: [],
      }).success,
    ).toBe(false);
  });

  it("requires planner provenance on the final TaskSpec", () => {
    const response = taskPlanResponseSchema.parse({
      task: {
        schemaVersion: 1,
        taskId: "task-agent-1",
        goal: "prepare_focus_session",
        requestedBy: "user-1",
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
              input: { heightMm: 780 },
            },
          },
        ],
      },
      planner: {
        framework: "mastra",
        provider: "openai",
        model: "openai/gpt-5.5",
      },
    });

    expect(response.planner.provider).toBe("openai");
  });
});

describe("TaskRunView contract", () => {
  it("carries bounded lumbar telemetry from the station owner", () => {
    const snapshot = workstationSnapshotSchema.parse({
      schemaVersion: 1,
      stationId: "station-sim-1",
      stateVersion: 2,
      observedAtMs: 1_100,
      deskHeightMm: 720,
      lumbarSupportPercent: 65,
      movementCount: 1,
    });

    expect(snapshot.lumbarSupportPercent).toBe(65);
    expect(
      workstationSnapshotSchema.safeParse({
        ...snapshot,
        lumbarSupportPercent: 101,
      }).success,
    ).toBe(false);
  });

  it("accepts ordered desk motion progress from the station runtime", () => {
    const progress = [
      {
        sequence: 1,
        commandId: "command-run-task-web-1",
        progressPercent: 0,
        deskHeightMm: 720,
        atMs: 1_100,
      },
      {
        sequence: 2,
        commandId: "command-run-task-web-1",
        progressPercent: 100,
        deskHeightMm: 780,
        atMs: 2_000,
      },
    ];

    const parsed = taskRunViewSchema.parse({
      runId: "run-task-web-progress",
      taskId: "task-web-progress",
      task: {
        schemaVersion: 1,
        taskId: "task-web-progress",
        goal: "prepare_focus_session",
        requestedBy: "user-1",
        constraints: {},
        assumptions: [],
        steps: [
          {
            stepId: "desk-1",
            action: {
              type: "desk.move_to_height",
              input: { heightMm: 780 },
            },
          },
        ],
      },
      status: "completed",
      suspensionReason: null,
      approval: null,
      command: null,
      commandEvents: [],
      deskMotionProgress: progress,
      events: [],
      policyDecision: {
        outcome: "require_approval",
        ruleIds: ["desk.motion.requires_approval"],
        reasonCode: null,
      },
    });

    expect(parsed.deskMotionProgress).toEqual(progress);
    expect(
      taskRunViewSchema.safeParse({
        ...parsed,
        deskMotionProgress: [progress[1], progress[0]],
      }).success,
    ).toBe(false);
  });

  it("accepts dedicated recovery and cancellation events", () => {
    expect(
      taskEventSchema.parse({
        sequence: 5,
        eventType: "run_resume_attempted",
        atMs: 1_150,
      }).eventType,
    ).toBe("run_resume_attempted");
    expect(
      taskEventSchema.parse({
        sequence: 6,
        eventType: "run_resumed",
        atMs: 1_200,
      }).eventType,
    ).toBe("run_resumed");
    expect(
      taskEventSchema.parse({
        sequence: 3,
        eventType: "run_cancelled",
        atMs: 1_100,
      }).eventType,
    ).toBe("run_cancelled");
  });

  it("keeps suspension reasons exclusive to suspended runs", () => {
    const run = taskRunViewSchema.parse({
      runId: "run-task-web-1",
      taskId: "task-web-1",
      task: {
        schemaVersion: 1,
        taskId: "task-web-1",
        goal: "prepare_focus_session",
        requestedBy: "user-1",
        constraints: {},
        assumptions: [],
        steps: [
          {
            stepId: "desk-1",
            action: {
              type: "desk.move_to_height",
              input: { heightMm: 780 },
            },
          },
        ],
      },
      status: "awaiting_approval",
      suspensionReason: null,
      approval: {
        approvalId: "approval-run-task-web-1",
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
    });

    expect(run.approval?.status).toBe("pending");
    expect(run.suspensionReason).toBeNull();
    const cancelledRun = {
      ...run,
      status: "cancelled",
      approval: { ...run.approval, status: "cancelled" },
      events: [
        ...run.events,
        { sequence: 3, eventType: "run_cancelled", atMs: 1_100 },
      ],
    };
    expect(taskRunViewSchema.parse(cancelledRun).status).toBe("cancelled");
    const invalidCancelledRuns = [
      {
        ...cancelledRun,
        approval: { ...cancelledRun.approval, status: "approved" },
      },
      {
        ...cancelledRun,
        command: {
          commandId: "cmd-run-task-web-1-desk-1",
          idempotencyKey: "run-task-web-1:desk-1",
          status: "succeeded",
          outcome: {
            stateVersion: 2,
            deskHeightMm: 780,
            verifiedAtMs: 1_100,
          },
          wasReplayed: false,
        },
      },
      {
        ...cancelledRun,
        commandEvents: [
          {
            sequence: 1,
            commandId: "cmd-run-task-web-1-desk-1",
            eventType: "accepted",
            atMs: 1_100,
          },
        ],
      },
      { ...cancelledRun, events: run.events },
    ];
    for (const candidate of invalidCancelledRuns) {
      expect(taskRunViewSchema.safeParse(candidate).success).toBe(false);
    }
    expect(
      taskRunViewSchema.safeParse({
        ...run,
        status: "completed",
        suspensionReason: "expired",
      }).success,
    ).toBe(false);
  });
});
