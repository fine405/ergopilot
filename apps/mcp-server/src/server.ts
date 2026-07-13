import { randomUUID } from "node:crypto";
import {
  type CapabilityCatalogResponse,
  capabilityCatalogResponseSchema,
  safeDeskHeightMmSchema,
  schemaVersion,
  type TaskRunView,
  type TaskSpec,
  taskRunViewSchema,
  type WorkstationSnapshot,
  workstationSnapshotSchema,
} from "@ergopilot/contracts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface ErgoPilotControlPlane {
  listCapabilities(): Promise<CapabilityCatalogResponse>;
  getState(): Promise<WorkstationSnapshot>;
  proposeTask(task: TaskSpec): Promise<TaskRunView>;
  inspectRun(runId: string): Promise<TaskRunView>;
}

export interface ErgoPilotMcpServerOptions {
  idFactory?: () => string;
}

const pendingProposalRunSchema = taskRunViewSchema.refine(
  (run) =>
    run.status === "awaiting_approval" &&
    run.approval?.status === "pending" &&
    run.policyDecision.outcome === "require_approval" &&
    run.command === null &&
    run.commandEvents.length === 0 &&
    run.deskMotionProgress.length === 0,
  { message: "control plane did not preserve the proposal-only boundary" },
);

const proposalResultSchema = z
  .object({
    run: pendingProposalRunSchema,
    safetyBoundary: z
      .object({
        approvalRequired: z.literal(true),
        deviceMoved: z.literal(false),
      })
      .strict(),
  })
  .strict();

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function createErgoPilotMcpServer(
  controlPlane: ErgoPilotControlPlane,
  options: ErgoPilotMcpServerOptions = {},
) {
  const idFactory = options.idFactory ?? randomUUID;
  const server = new McpServer(
    { name: "ergopilot", version: "0.1.0" },
    {
      instructions:
        "Use tools to inspect the workstation or create a proposal. ErgoPilot MCP cannot approve or directly execute physical motion; approval must happen in the trusted operator UI.",
    },
  );

  server.registerTool(
    "workstation.list_capabilities",
    {
      title: "List workstation capabilities",
      description:
        "List versioned device actions, parameter limits, risks, and approval requirements.",
      outputSchema: capabilityCatalogResponseSchema,
      annotations: readOnlyAnnotations,
    },
    async () => structuredResult(await controlPlane.listCapabilities()),
  );

  server.registerTool(
    "workstation.get_state",
    {
      title: "Read workstation state",
      description:
        "Read the station-owned observation of the current physical workstation state.",
      outputSchema: workstationSnapshotSchema,
      annotations: readOnlyAnnotations,
    },
    async () => structuredResult(await controlPlane.getState()),
  );

  server.registerTool(
    "workstation.propose_desk_motion",
    {
      title: "Propose desk motion",
      description:
        "Create a desk-height task that remains pending until a person approves it in the trusted operator UI.",
      inputSchema: {
        heightMm: safeDeskHeightMmSchema,
        requestedBy: z.string().trim().min(1).max(128),
        durationMinutes: z.number().int().positive().max(65_535).optional(),
        interruptionPolicy: z.enum(["normal", "critical-only"]).optional(),
      },
      outputSchema: proposalResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ heightMm, requestedBy, durationMinutes, interruptionPolicy }) => {
      const constraints = {
        ...(durationMinutes === undefined ? {} : { durationMinutes }),
        ...(interruptionPolicy === undefined ? {} : { interruptionPolicy }),
      };
      const run = pendingProposalRunSchema.parse(
        await controlPlane.proposeTask({
          schemaVersion,
          taskId: `task-mcp-${idFactory()}`,
          goal: "prepare_focus_session",
          requestedBy,
          constraints,
          assumptions: [
            "MCP created a proposal; explicit user approval is required before physical motion.",
          ],
          steps: [
            {
              stepId: "desk-motion-1",
              action: {
                type: "desk.move_to_height",
                input: { heightMm },
              },
            },
          ],
        }),
      );
      return structuredResult({
        run,
        safetyBoundary: { approvalRequired: true, deviceMoved: false },
      });
    },
  );

  server.registerTool(
    "workstation.inspect_run",
    {
      title: "Inspect workstation run",
      description:
        "Read a task run, including approval, command, progress, and recovery evidence.",
      inputSchema: {
        runId: z.string().trim().min(1).max(128),
      },
      outputSchema: taskRunViewSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ runId }) => structuredResult(await controlPlane.inspectRun(runId)),
  );

  return server;
}

function structuredResult<T extends Record<string, unknown>>(value: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}
