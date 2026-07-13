import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { HttpErgoPilotControlPlane } from "./control-plane-client";
import { createErgoPilotMcpServer } from "./server";

const controlPlaneUrl =
  process.env.ERGOPILOT_CONTROL_PLANE_URL ?? "http://localhost:8787";
const server = createErgoPilotMcpServer(
  new HttpErgoPilotControlPlane(controlPlaneUrl),
);

await server.connect(new StdioServerTransport());
