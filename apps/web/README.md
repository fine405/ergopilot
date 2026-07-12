# ErgoPilot web console

This TanStack Start application is the operator surface for ErgoPilot. It can
request a bounded single-step `TaskSpec` from the optional Mastra planner or
create the same task deterministically, then displays policy evidence, explicit
desk-motion approval, station state and durable run events.

Run the complete system from the repository root with `pnpm dev`. The browser
uses `http://localhost:8787` by default; set `VITE_CONTROL_PLANE_URL` to point at
another Hono control plane.

shadcn/ui owns the deterministic controls. AI Elements `Task` renders the
generated plan; richer AI message components and assistant-ui remain deferred
until model explanations, tools or multi-thread conversation become real
requirements.
