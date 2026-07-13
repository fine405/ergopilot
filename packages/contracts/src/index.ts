import { z } from "zod";

export const schemaVersion = 1 as const;

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const actorIdSchema = z.string().trim().min(1).max(128);
const assumptionSchema = z.string().trim().min(1).max(256);

export const deviceActionSchema = z
  .object({
    type: z.literal("desk.move_to_height"),
    input: z
      .object({
        heightMm: z.number().int().min(0).max(65_535),
      })
      .strict(),
  })
  .strict();

export const taskGoalSchema = z.enum([
  "prepare_focus_session",
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
    steps: z.array(plannedStepSchema).length(1),
  })
  .strict();

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

export const taskPlanDraftSchema = z
  .object({
    targetHeightMm: z.number().int().min(620).max(1_280),
    durationMinutes: z.number().int().min(15).max(180),
    interruptionPolicy: z.enum(["normal", "critical-only"]),
    assumptions: z.array(assumptionSchema).max(8),
  })
  .strict();

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
export type PlannerProvider = z.infer<typeof plannerProviderSchema>;
export type PlannerProviderId = z.infer<typeof plannerProviderIdSchema>;
export type PlannerProvidersResponse = z.infer<
  typeof plannerProvidersResponseSchema
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
export type DeskMotionProgress = z.infer<typeof deskMotionProgressSchema>;
export type WorkstationSnapshot = z.infer<typeof workstationSnapshotSchema>;
export type RuntimeObservation = z.infer<typeof runtimeObservationSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export type CancellationRequest = z.infer<typeof cancellationRequestSchema>;
