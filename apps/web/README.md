# ErgoPilot web console

This TanStack Start application is the operator surface for ErgoPilot. It can
request a bounded `TaskSpec` from the optional Mastra planner or create a
deterministic task. It supports one-step desk/chair actions and an ordered
two-step workstation profile, then displays policy evidence, explicit approval,
station state and durable run events.

Run the complete system from the repository root with `pnpm dev`. The browser
uses `http://localhost:8787` by default; set `VITE_CONTROL_PLANE_URL` to point at
another Hono control plane.

The `/lab` route drives the existing Rust simulator fault paths, including a
known partial actuator jam at 60%, and renders their recovery evidence. The
`/evals` route reads schema-validated published and local planner reports
through the Hono control plane. Neither route gives the browser direct access
to SQLite or device RPC method names.

The normal operator console adds a confirmation checkpoint before clearing a
jam and authorizing the remaining simulated motion. The completed run keeps the
failed command, its journal events and its last physical progress sample.

shadcn/ui owns the deterministic controls. The provider selector enables only
providers configured by the control plane, and AI Elements `Task` renders the
generated plan. Richer AI message components and assistant-ui remain deferred
until model explanations, tools or multi-thread conversation become real
requirements.
