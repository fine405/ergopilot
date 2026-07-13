import {
  defaultWorkstationSnapshotFields,
  type WorkstationSnapshot,
  workstationCapabilityCatalog,
} from "@ergopilot/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createErgoPilotMcpServer, type ErgoPilotControlPlane } from "./server";
import { createAwaitingApprovalRun } from "./test-fixtures";

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

describe("ErgoPilot MCP server", () => {
  it("exposes only bounded query and proposal tools", async () => {
    const client = await connectClient(fakeControlPlane());

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      "workstation.list_capabilities",
      "workstation.get_state",
      "workstation.propose_desk_motion",
      "workstation.propose_lumbar_support",
      "workstation.inspect_run",
    ]);
    expect(tools.some((tool) => tool.name.includes("approve"))).toBe(false);
    expect(tools[0]?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tools[2]?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("returns the validated capability catalog as structured MCP content", async () => {
    const controlPlane = fakeControlPlane();
    vi.mocked(controlPlane.listCapabilities).mockResolvedValue(
      workstationCapabilityCatalog,
    );
    const client = await connectClient(controlPlane);

    const result = await client.callTool({
      name: "workstation.list_capabilities",
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(workstationCapabilityCatalog);
    expect(controlPlane.listCapabilities).toHaveBeenCalledOnce();
  });

  it("creates a pending proposal without moving or approving the device", async () => {
    const controlPlane = fakeControlPlane();
    vi.mocked(controlPlane.proposeTask).mockImplementation(async (task) =>
      createAwaitingApprovalRun(task),
    );
    const client = await connectClient(controlPlane);

    const result = await client.callTool({
      name: "workstation.propose_desk_motion",
      arguments: {
        heightMm: 780,
        requestedBy: "agent-user",
        durationMinutes: 45,
        interruptionPolicy: "critical-only",
      },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      run: { status: "awaiting_approval" },
      safetyBoundary: { approvalRequired: true, deviceMoved: false },
    });
    expect(controlPlane.proposeTask).toHaveBeenCalledWith({
      schemaVersion: 1,
      taskId: "task-mcp-fixed-id",
      goal: "prepare_focus_session",
      requestedBy: "agent-user",
      constraints: {
        durationMinutes: 45,
        interruptionPolicy: "critical-only",
      },
      assumptions: [
        "MCP created a proposal; explicit user approval is required before physical motion.",
      ],
      steps: [
        {
          stepId: "desk-motion-1",
          action: {
            type: "desk.move_to_height",
            input: { heightMm: 780 },
          },
        },
      ],
    });
    expect(controlPlane.getState).not.toHaveBeenCalled();
  });

  it("creates a pending lumbar proposal without moving or approving the chair", async () => {
    const controlPlane = fakeControlPlane();
    vi.mocked(controlPlane.proposeTask).mockImplementation(async (task) =>
      createAwaitingApprovalRun(task),
    );
    const client = await connectClient(controlPlane);

    const result = await client.callTool({
      name: "workstation.propose_lumbar_support",
      arguments: {
        levelPercent: 65,
        requestedBy: "agent-user",
        durationMinutes: 30,
      },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      run: { status: "awaiting_approval" },
      safetyBoundary: { approvalRequired: true, deviceMoved: false },
    });
    expect(controlPlane.proposeTask).toHaveBeenCalledWith({
      schemaVersion: 1,
      taskId: "task-mcp-fixed-id",
      goal: "adjust_seated_support",
      requestedBy: "agent-user",
      constraints: { durationMinutes: 30 },
      assumptions: [
        "MCP created a proposal; explicit user approval is required before physical motion.",
      ],
      steps: [
        {
          stepId: "chair-lumbar-1",
          action: {
            type: "chair.set_lumbar_support",
            input: { levelPercent: 65 },
          },
        },
      ],
    });
    expect(controlPlane.getState).not.toHaveBeenCalled();
  });

  it("reads station-owned device state", async () => {
    const controlPlane = fakeControlPlane();
    const snapshot: WorkstationSnapshot = {
      ...defaultWorkstationSnapshotFields,
      schemaVersion: 1,
      stationId: "station-sim-1",
      stateVersion: 7,
      observedAtMs: 1_200,
      deskHeightMm: 720,
      lumbarSupportPercent: 35,
      movementCount: 3,
    };
    vi.mocked(controlPlane.getState).mockResolvedValue(snapshot);
    const client = await connectClient(controlPlane);

    const result = await client.callTool({ name: "workstation.get_state" });

    expect(result.structuredContent).toEqual(snapshot);
    expect(controlPlane.getState).toHaveBeenCalledOnce();
  });

  it("reads durable run and approval evidence", async () => {
    const controlPlane = fakeControlPlane();
    const run = createAwaitingApprovalRun({
      schemaVersion: 1,
      taskId: "task-existing-1",
      goal: "prepare_focus_session",
      requestedBy: "user-1",
      constraints: {},
      assumptions: [],
      steps: [
        {
          stepId: "desk-1",
          action: {
            type: "desk.move_to_height",
            input: { heightMm: 760 },
          },
        },
      ],
    });
    vi.mocked(controlPlane.inspectRun).mockResolvedValue(run);
    const client = await connectClient(controlPlane);

    const result = await client.callTool({
      name: "workstation.inspect_run",
      arguments: { runId: run.runId },
    });

    expect(result.structuredContent).toEqual(run);
    expect(controlPlane.inspectRun).toHaveBeenCalledWith(run.runId);
  });

  it("rejects unsafe desk heights before reaching the control plane", async () => {
    const controlPlane = fakeControlPlane();
    const client = await connectClient(controlPlane);

    const result = await client.callTool({
      name: "workstation.propose_desk_motion",
      arguments: { heightMm: 1_400, requestedBy: "agent-user" },
    });

    expect(result.isError).toBe(true);
    expect(controlPlane.proposeTask).not.toHaveBeenCalled();
  });

  it("rejects unsafe lumbar levels before reaching the control plane", async () => {
    const controlPlane = fakeControlPlane();
    const client = await connectClient(controlPlane);

    const result = await client.callTool({
      name: "workstation.propose_lumbar_support",
      arguments: { levelPercent: 101, requestedBy: "agent-user" },
    });

    expect(result.isError).toBe(true);
    expect(controlPlane.proposeTask).not.toHaveBeenCalled();
  });

  it("rejects a control-plane response that crossed the approval boundary", async () => {
    const controlPlane = fakeControlPlane();
    vi.mocked(controlPlane.proposeTask).mockImplementation(async (task) => ({
      ...createAwaitingApprovalRun(task),
      status: "completed",
    }));
    const client = await connectClient(controlPlane);

    const result = await client.callTool({
      name: "workstation.propose_desk_motion",
      arguments: { heightMm: 780, requestedBy: "agent-user" },
    });

    expect(result.isError).toBe(true);
  });

  it("rejects a pending response for a different proposed chair action", async () => {
    const controlPlane = fakeControlPlane();
    vi.mocked(controlPlane.proposeTask).mockImplementation(async (task) =>
      createAwaitingApprovalRun({
        ...task,
        steps: [
          {
            stepId: "chair-lumbar-1",
            action: {
              type: "chair.set_lumbar_support",
              input: { levelPercent: 66 },
            },
          },
        ],
      }),
    );
    const client = await connectClient(controlPlane);

    const result = await client.callTool({
      name: "workstation.propose_lumbar_support",
      arguments: { levelPercent: 65, requestedBy: "agent-user" },
    });

    expect(result.isError).toBe(true);
  });
});

async function connectClient(controlPlane: ErgoPilotControlPlane) {
  const server = createErgoPilotMcpServer(controlPlane, {
    idFactory: () => "fixed-id",
  });
  const client = new Client({ name: "ergopilot-test", version: "0.1.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closeCallbacks.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

function fakeControlPlane(): ErgoPilotControlPlane {
  return {
    listCapabilities: vi.fn(),
    getState: vi.fn(),
    proposeTask: vi.fn(),
    inspectRun: vi.fn(),
  };
}
