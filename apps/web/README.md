# ErgoPilot web console

This TanStack Start application is the operator surface for the deterministic
ErgoPilot tracer bullet. It creates a typed single-step `TaskSpec`, displays the
policy decision, requests explicit approval for desk motion, and renders the
station snapshot plus durable run events.

Run the complete system from the repository root with `pnpm dev`. The browser
uses `http://localhost:8787` by default; set `VITE_CONTROL_PLANE_URL` to point at
another Hono control plane.

shadcn/ui owns the deterministic application controls. AI Elements will be
introduced when the Mastra/AI SDK slice produces model explanations and tool
parts; assistant-ui remains deferred unless the product gains a real
multi-thread chat requirement.
