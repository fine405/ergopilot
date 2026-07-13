import { z } from "zod";

export const schemaVersion = 1 as const;
export const minimumDeskHeightMm = 620 as const;
export const maximumDeskHeightMm = 1_280 as const;
export const safeDeskHeightMmSchema = z
  .number()
  .int()
  .min(minimumDeskHeightMm)
  .max(maximumDeskHeightMm);
export const minimumLumbarSupportPercent = 0 as const;
export const maximumLumbarSupportPercent = 100 as const;
export const defaultLumbarSupportPercent = 35 as const;
export const safeLumbarSupportPercentSchema = z
  .number()
  .int()
  .min(minimumLumbarSupportPercent)
  .max(maximumLumbarSupportPercent);

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const actorIdSchema = z.string().trim().min(1).max(128);
const assumptionSchema = z.string().trim().min(1).max(256);

const numericCapabilityInputSchema = z
  .object({
    type: z.literal("object"),
    additionalProperties: z.literal(false),
    required: z.array(identifierSchema).min(1),
    properties: z.record(
      identifierSchema,
      z
        .object({
          type: z.literal("integer"),
          minimum: z.number().int(),
          maximum: z.number().int(),
        })
        .strict(),
    ),
  })
  .strict();

export const capabilityDescriptorSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    id: identifierSchema,
    title: z.string().trim().min(1).max(128),
    mode: z.enum(["read", "action"]),
    risk: z.enum(["read", "reversible", "motion", "restricted"]),
    inputSchema: numericCapabilityInputSchema,
    timeoutMs: z.number().int().positive(),
    cancelable: z.boolean(),
    freshnessMs: z.number().int().positive().optional(),
    preconditions: z.array(identifierSchema),
    approval: z
      .object({
        required: z.boolean(),
      })
      .strict(),
    verification: z
      .object({
        strategy: z.literal("read_after_write"),
        observedField: identifierSchema,
      })
      .strict(),
  })
  .strict();

export const capabilityCatalogResponseSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    capabilities: z.array(capabilityDescriptorSchema),
  })
  .strict();

export const workstationCapabilityCatalog =
  capabilityCatalogResponseSchema.parse({
    schemaVersion,
    capabilities: [
      {
        schemaVersion,
        id: "desk.move_to_height",
        title: "Move standing desk",
        mode: "action",
        risk: "motion",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["heightMm"],
          properties: {
            heightMm: {
              type: "integer",
              minimum: minimumDeskHeightMm,
              maximum: maximumDeskHeightMm,
            },
          },
        },
        timeoutMs: 5_000,
        cancelable: false,
        preconditions: ["station.online", "station.snapshot_fresh"],
        approval: { required: true },
        verification: {
          strategy: "read_after_write",
          observedField: "deskHeightMm",
        },
      },
      {
        schemaVersion,
        id: "chair.set_lumbar_support",
        title: "Adjust smart-chair lumbar support",
        mode: "action",
        risk: "motion",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["levelPercent"],
          properties: {
            levelPercent: {
              type: "integer",
              minimum: minimumLumbarSupportPercent,
              maximum: maximumLumbarSupportPercent,
            },
          },
        },
        timeoutMs: 2_000,
        cancelable: false,
        preconditions: ["station.online", "station.snapshot_fresh"],
        approval: { required: true },
        verification: {
          strategy: "read_after_write",
          observedField: "lumbarSupportPercent",
        },
      },
    ],
  });

export const deviceActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("desk.move_to_height"),
      input: z
        .object({
          heightMm: z.number().int().min(0).max(65_535),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("chair.set_lumbar_support"),
      input: z
        .object({
          levelPercent: z.number().int().min(0).max(255),
        })
        .strict(),
    })
    .strict(),
]);

export const taskGoalSchema = z.enum([
  "prepare_focus_session",
  "adjust_seated_support",
  "relieve_neck_discomfort",
  "restore_profile",
]);

export const taskConstraintsSchema = z
  .object({
    durationMinutes: z.number().int().positive().max(65_535).optional(),
    interruptionPolicy: z.enum(["normal", "critical-only"]).optional(),
  })
  .strict();

export const plannedStepSchema = z
  .object({
    stepId: identifierSchema,
    action: deviceActionSchema,
  })
  .strict();

export const taskSpecSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    taskId: identifierSchema,
    goal: taskGoalSchema,
    requestedBy: actorIdSchema,
    constraints: taskConstraintsSchema,
    assumptions: z.array(assumptionSchema).max(16),
    steps: z.array(plannedStepSchema).min(1).max(2),
  })
  .strict()
  .superRefine((task, context) => {
    if (task.goal === "restore_profile" && task.steps.length !== 2) {
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message: "restore_profile requires exactly two planned steps",
      });
    }
    if (task.steps.length !== 2) return;
    const [deskStep, chairStep] = task.steps;
    if (
      task.goal !== "restore_profile" ||
      deskStep?.action.type !== "desk.move_to_height" ||
      chairStep?.action.type !== "chair.set_lumbar_support"
    ) {
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message: "restore_profile requires desk then lumbar steps",
      });
    }
    if (deskStep?.stepId === chairStep?.stepId) {
      context.addIssue({
        code: "custom",
        path: ["steps", 1, "stepId"],
        message: "stepId values must be unique",
      });
    }
  });

export const plannerProviderIdSchema = z.enum(["openai", "deepseek"]);

export const plannerProviderSchema = z
  .object({
    id: plannerProviderIdSchema,
    name: z.string().trim().min(1),
    model: z.string().trim().min(1),
    enabled: z.boolean(),
  })
  .strict();

export const plannerProvidersResponseSchema = z
  .object({
    providers: z.array(plannerProviderSchema),
  })
  .strict();

const plannerEvaluationCaseResultSchema = z
  .object({
    caseId: identifierSchema,
    passed: z.boolean(),
    failures: z.array(z.string().trim().min(1).max(512)).max(16),
    durationMs: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.passed && result.failures.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["failures"],
        message: "passing evaluation cases cannot contain failures",
      });
    }
    if (!result.passed && result.failures.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["failures"],
        message: "failing evaluation cases must contain evidence",
      });
    }
  });

export const plannerEvaluationReportSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    generatedAt: z.iso.datetime(),
    suite: z.enum(["smoke", "full"]),
    provider: plannerProviderIdSchema,
    model: z.string().trim().min(1).nullable(),
    sourceCommit: identifierSchema.nullable(),
    totalCases: z.number().int().positive(),
    passedCases: z.number().int().nonnegative(),
    passRate: z.number().min(0).max(1),
    latencyMs: z
      .object({
        p50: z.number().int().nonnegative(),
        p95: z.number().int().nonnegative(),
      })
      .strict(),
    results: z.array(plannerEvaluationCaseResultSchema).min(1).max(100),
  })
  .strict()
  .superRefine((report, context) => {
    const passedCases = report.results.filter((result) => result.passed).length;
    if (report.results.length !== report.totalCases) {
      context.addIssue({
        code: "custom",
        path: ["totalCases"],
        message: "totalCases must match the case evidence",
      });
    }
    if (passedCases !== report.passedCases) {
      context.addIssue({
        code: "custom",
        path: ["passedCases"],
        message: "passedCases must match the case evidence",
      });
    }
    const expectedPassRate = passedCases / report.results.length;
    if (Math.abs(report.passRate - expectedPassRate) > Number.EPSILON) {
      context.addIssue({
        code: "custom",
        path: ["passRate"],
        message: "passRate must match the case evidence",
      });
    }
    if (report.latencyMs.p50 > report.latencyMs.p95) {
      context.addIssue({
        code: "custom",
        path: ["latencyMs", "p50"],
        message: "p50 latency cannot exceed p95 latency",
      });
    }
  });

export const plannerEvaluationsResponseSchema = z
  .object({
    reports: z.array(plannerEvaluationReportSchema).max(100),
  })
  .strict();

const plannerRuntimeErrorCodeSchema = z.enum([
  "provider_unavailable",
  "generation_failed",
  "generation_timeout",
  "invalid_plan",
  "internal_error",
]);

export const plannerAttemptErrorCodeSchema = z.enum([
  ...plannerRuntimeErrorCodeSchema.options,
  "invalid_request",
  "payload_too_large",
]);

const plannerAttemptBaseSchema = z
  .object({
    traceId: identifierSchema,
    startedAtMs: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

const attributedPlannerAttemptBaseSchema = plannerAttemptBaseSchema.extend({
  provider: plannerProviderIdSchema,
  model: z.string().trim().min(1),
});

const failedRequestAttemptFields = {
  outcome: z.literal("failed"),
  taskId: z.null(),
} as const;

export const plannerAttemptSchema = z.union([
  attributedPlannerAttemptBaseSchema.extend({
    outcome: z.literal("succeeded"),
    taskId: identifierSchema,
    errorCode: z.null(),
  }),
  attributedPlannerAttemptBaseSchema.extend({
    outcome: z.literal("failed"),
    taskId: z.null(),
    errorCode: plannerRuntimeErrorCodeSchema,
  }),
  attributedPlannerAttemptBaseSchema.extend({
    ...failedRequestAttemptFields,
    errorCode: z.literal("invalid_request"),
  }),
  plannerAttemptBaseSchema.extend({
    provider: z.null(),
    model: z.null(),
    ...failedRequestAttemptFields,
    errorCode: z.enum(["invalid_request", "payload_too_large"]),
  }),
]);

export const plannerAttemptsResponseSchema = z
  .object({
    attempts: z.array(plannerAttemptSchema).max(100),
  })
  .strict();

export const taskPlanRequestSchema = z
  .object({
    provider: plannerProviderIdSchema,
    prompt: z.string().trim().min(1).max(2_000),
    requestedBy: actorIdSchema,
  })
  .strict();

const taskPlanDraftFields = {
  durationMinutes: z.number().int().min(15).max(180),
  interruptionPolicy: z.enum(["normal", "critical-only"]),
  assumptions: z.array(assumptionSchema).max(8),
};

export const taskPlanDraftSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("desk.move_to_height"),
      targetHeightMm: safeDeskHeightMmSchema,
      ...taskPlanDraftFields,
    })
    .strict(),
  z
    .object({
      action: z.literal("chair.set_lumbar_support"),
      lumbarSupportPercent: safeLumbarSupportPercentSchema,
      ...taskPlanDraftFields,
    })
    .strict(),
  z
    .object({
      action: z.literal("workstation.restore_profile"),
      targetHeightMm: safeDeskHeightMmSchema,
      lumbarSupportPercent: safeLumbarSupportPercentSchema,
      ...taskPlanDraftFields,
    })
    .strict(),
]);

export const taskPlanResponseSchema = z
  .object({
    task: taskSpecSchema,
    planner: z
      .object({
        framework: z.literal("mastra"),
        provider: plannerProviderIdSchema,
        model: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();

export const policyDecisionSchema = z
  .object({
    outcome: z.enum(["allow", "require_approval", "deny"]),
    ruleIds: z.array(z.string()),
    reasonCode: z.string().nullable(),
  })
  .strict();

export const approvalViewSchema = z
  .object({
    approvalId: z.string(),
    expiresAtMs: z.number().int().nonnegative(),
    status: z.enum(["pending", "approved", "expired", "cancelled"]),
    approvedBy: z.string().nullable(),
    approvedAtMs: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const verifiedOutcomeSchema = z
  .object({
    stateVersion: z.number().int().nonnegative(),
    deskHeightMm: z.number().int().nonnegative(),
    lumbarSupportPercent: safeLumbarSupportPercentSchema.default(
      defaultLumbarSupportPercent,
    ),
    verifiedAtMs: z.number().int().nonnegative(),
  })
  .strict();

export const commandViewSchema = z
  .object({
    commandId: z.string(),
    idempotencyKey: z.string(),
    status: z.enum([
      "accepted",
      "executing",
      "outcome_unknown",
      "succeeded",
      "failed",
    ]),
    outcome: verifiedOutcomeSchema.nullable(),
    failureReason: z.enum(["actuator_fault"]).optional(),
    wasReplayed: z.boolean(),
  })
  .strict();

export const commandEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    commandId: z.string(),
    eventType: z.enum([
      "accepted",
      "executing",
      "outcome_unknown",
      "verified_succeeded",
      "verification_failed",
      "execution_failed",
      "reconciliation_pending",
      "reconciled_succeeded",
    ]),
    atMs: z.number().int().nonnegative(),
  })
  .strict();

export const deskMotionProgressSchema = z
  .object({
    sequence: z.number().int().positive(),
    commandId: identifierSchema,
    progressPercent: z.number().int().min(0).max(100),
    deskHeightMm: z.number().int().min(0).max(65_535),
    atMs: z.number().int().nonnegative(),
  })
  .strict();

export const completedTaskStepSchema = z
  .object({
    stepId: identifierSchema,
    command: commandViewSchema,
    commandEvents: z.array(commandEventSchema),
    deskMotionProgress: z.array(deskMotionProgressSchema).max(101),
  })
  .strict();

export const taskEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    eventType: z.enum([
      "run_started",
      "approval_required",
      "approval_granted",
      "approval_expired",
      "command_dispatched",
      "run_completed",
      "outcome_unknown",
      "run_failed",
      "policy_denied",
      "run_reconciled",
      "run_resume_attempted",
      "run_resumed",
      "run_suspended",
      "run_cancelled",
    ]),
    atMs: z.number().int().nonnegative(),
  })
  .strict();

const suspensionReasonSchema = z.enum([
  "device_unavailable",
  "actuator_fault",
  "stale_state",
  "expired",
]);

export const taskRunViewSchema = z
  .object({
    runId: z.string(),
    taskId: z.string(),
    task: taskSpecSchema,
    status: z.enum([
      "awaiting_approval",
      "executing",
      "completed",
      "outcome_unknown",
      "failed",
      "denied",
      "suspended",
      "cancelled",
    ]),
    suspensionReason: suspensionReasonSchema.nullable(),
    approval: approvalViewSchema.nullable(),
    command: commandViewSchema.nullable(),
    commandEvents: z.array(commandEventSchema),
    deskMotionProgress: z.array(deskMotionProgressSchema).max(101),
    completedSteps: z.array(completedTaskStepSchema).max(2).optional(),
    commandAttempts: z.array(completedTaskStepSchema).max(4).optional(),
    events: z.array(taskEventSchema),
    policyDecision: policyDecisionSchema,
  })
  .strict()
  .superRefine((run, context) => {
    for (let index = 1; index < run.deskMotionProgress.length; index += 1) {
      const previous = run.deskMotionProgress[index - 1];
      const current = run.deskMotionProgress[index];
      if (
        previous &&
        current &&
        (current.sequence <= previous.sequence ||
          current.progressPercent <= previous.progressPercent)
      ) {
        context.addIssue({
          code: "custom",
          path: ["deskMotionProgress", index],
          message: "desk motion progress must be strictly ordered",
        });
      }
    }
    if (run.status !== "suspended" && run.suspensionReason !== null) {
      context.addIssue({
        code: "custom",
        path: ["suspensionReason"],
        message: "suspensionReason must be null unless status is suspended",
      });
    }
    if (run.command?.failureReason && run.command.status !== "failed") {
      context.addIssue({
        code: "custom",
        path: ["command", "failureReason"],
        message: "failureReason is only valid for a failed command",
      });
    }
    const validActuatorAttempts = new Set<string>();
    for (const [index, attempt] of (run.commandAttempts ?? []).entries()) {
      if (attempt.command.failureReason !== "actuator_fault") continue;
      const step = run.task.steps.find(
        (candidate) => candidate.stepId === attempt.stepId,
      );
      const lastProgress = attempt.deskMotionProgress
        .filter((progress) => progress.commandId === attempt.command.commandId)
        .at(-1);
      const valid =
        step?.action.type === "desk.move_to_height" &&
        attempt.command.status === "failed" &&
        attempt.commandEvents.some(
          (event) =>
            event.commandId === attempt.command.commandId &&
            event.eventType === "execution_failed",
        ) &&
        lastProgress !== undefined &&
        lastProgress.progressPercent > 0 &&
        lastProgress.progressPercent < 100;
      if (valid) {
        validActuatorAttempts.add(attempt.command.commandId);
      } else {
        context.addIssue({
          code: "custom",
          path: ["commandAttempts", index],
          message:
            "actuator fault attempts require a matching failed desk step, execution failure and known partial progress",
        });
      }
    }
    const currentClaimsActuatorFault =
      run.command?.failureReason === "actuator_fault" ||
      run.suspensionReason === "actuator_fault";
    if (currentClaimsActuatorFault) {
      const commandId = run.command?.commandId;
      const lastProgress = run.deskMotionProgress
        .filter((progress) => progress.commandId === commandId)
        .at(-1);
      const validCurrentEvidence =
        run.status === "suspended" &&
        run.suspensionReason === "actuator_fault" &&
        run.command?.status === "failed" &&
        run.command.failureReason === "actuator_fault" &&
        commandId !== undefined &&
        validActuatorAttempts.has(commandId) &&
        run.commandEvents.some(
          (event) =>
            event.commandId === commandId &&
            event.eventType === "execution_failed",
        ) &&
        lastProgress !== undefined &&
        lastProgress.progressPercent > 0 &&
        lastProgress.progressPercent < 100;
      if (!validCurrentEvidence) {
        context.addIssue({
          code: "custom",
          path: ["suspensionReason"],
          message:
            "current actuator_fault requires matching archived desk failure and partial-effect evidence",
        });
      }
    }
    if (run.status === "cancelled") {
      if (run.approval?.status !== "cancelled") {
        context.addIssue({
          code: "custom",
          path: ["approval"],
          message: "cancelled runs must have a cancelled approval",
        });
      }
      if (run.command !== null) {
        context.addIssue({
          code: "custom",
          path: ["command"],
          message: "cancelled runs must not have a device command",
        });
      }
      if (run.commandEvents.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["commandEvents"],
          message: "cancelled runs must not have command events",
        });
      }
      if (run.deskMotionProgress.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["deskMotionProgress"],
          message: "cancelled runs must not have motion progress",
        });
      }
      if (run.events.at(-1)?.eventType !== "run_cancelled") {
        context.addIssue({
          code: "custom",
          path: ["events"],
          message: "cancelled runs must end with run_cancelled evidence",
        });
      }
    }
  });

export const workstationSnapshotSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    stationId: z.string(),
    stateVersion: z.number().int().nonnegative(),
    observedAtMs: z.number().int().nonnegative(),
    deskHeightMm: z.number().int().nonnegative(),
    lumbarSupportPercent: safeLumbarSupportPercentSchema.default(
      defaultLumbarSupportPercent,
    ),
    movementCount: z.number().int().nonnegative(),
  })
  .strict();

export const runtimeObservationSchema = z
  .object({
    run: taskRunViewSchema,
    station: workstationSnapshotSchema,
  })
  .strict();

export const approvalRequestSchema = z
  .object({
    approvedBy: actorIdSchema,
  })
  .strict();

export const cancellationRequestSchema = z
  .object({
    cancelledBy: actorIdSchema,
  })
  .strict();

export type DeviceAction = z.infer<typeof deviceActionSchema>;
export type CapabilityDescriptor = z.infer<typeof capabilityDescriptorSchema>;
export type CapabilityCatalogResponse = z.infer<
  typeof capabilityCatalogResponseSchema
>;
export type PlannerProvider = z.infer<typeof plannerProviderSchema>;
export type PlannerProviderId = z.infer<typeof plannerProviderIdSchema>;
export type PlannerProvidersResponse = z.infer<
  typeof plannerProvidersResponseSchema
>;
export type PlannerEvaluationReport = z.infer<
  typeof plannerEvaluationReportSchema
>;
export type PlannerEvaluationsResponse = z.infer<
  typeof plannerEvaluationsResponseSchema
>;
export type PlannerAttempt = z.infer<typeof plannerAttemptSchema>;
export type PlannerAttemptsResponse = z.infer<
  typeof plannerAttemptsResponseSchema
>;
export type TaskPlanDraft = z.infer<typeof taskPlanDraftSchema>;
export type TaskPlanRequest = z.infer<typeof taskPlanRequestSchema>;
export type TaskPlanResponse = z.infer<typeof taskPlanResponseSchema>;
export type TaskSpec = z.infer<typeof taskSpecSchema>;
export type TaskRunView = z.infer<typeof taskRunViewSchema>;
export type CompletedTaskStep = z.infer<typeof completedTaskStepSchema>;
export type DeskMotionProgress = z.infer<typeof deskMotionProgressSchema>;
export type WorkstationSnapshot = z.infer<typeof workstationSnapshotSchema>;
export type RuntimeObservation = z.infer<typeof runtimeObservationSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export type CancellationRequest = z.infer<typeof cancellationRequestSchema>;
