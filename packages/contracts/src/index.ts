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

export const taskPlanRequestSchema = z
  .object({
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
    status: z.enum(["pending", "approved", "expired"]),
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
      "run_suspended",
    ]),
    atMs: z.number().int().nonnegative(),
  })
  .strict();

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
    ]),
    approval: approvalViewSchema.nullable(),
    command: commandViewSchema.nullable(),
    commandEvents: z.array(commandEventSchema),
    events: z.array(taskEventSchema),
    policyDecision: policyDecisionSchema,
  })
  .strict();

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

export const approvalRequestSchema = z
  .object({
    approvedBy: actorIdSchema,
  })
  .strict();

export type DeviceAction = z.infer<typeof deviceActionSchema>;
export type TaskPlanDraft = z.infer<typeof taskPlanDraftSchema>;
export type TaskPlanRequest = z.infer<typeof taskPlanRequestSchema>;
export type TaskPlanResponse = z.infer<typeof taskPlanResponseSchema>;
export type TaskSpec = z.infer<typeof taskSpecSchema>;
export type TaskRunView = z.infer<typeof taskRunViewSchema>;
export type WorkstationSnapshot = z.infer<typeof workstationSnapshotSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
