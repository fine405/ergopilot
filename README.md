# ErgoPilot

ErgoPilot is a recoverable embodied-agent runtime for a simulated ergonomic
workstation. It turns a user goal into safe, observable and resumable actions
across a chair, standing desk and desktop focus controls.

The project is deliberately not a posture chatbot. Its primary engineering
problem is reliable execution against fallible devices:

- semantic capability discovery;
- policy-gated actions and human approval;
- durable task orchestration;
- idempotent local execution;
- post-action state verification;
- crash and disconnect recovery;
- deterministic and model-based evaluation.

The implementation plan and acceptance criteria are in
[docs/PROJECT_BLUEPRINT.md](docs/PROJECT_BLUEPRINT.md).

## Planned stack

- TanStack Start, shadcn/ui and selected AI Elements for the web console
- Hono and Mastra for the control plane and cognitive layer
- Cloudflare Workers, Workflows and Durable Objects for cloud coordination
- Tauri 2 and Rust for the local station runtime
- SQLite for the local event journal
- A deterministic Rust simulator first, followed by MQTT/Home Assistant and
  optionally ROS 2/Gazebo adapters

## Current status

The local runtime and persistent approval tracer bullets are runnable. They
currently implement:

- a versioned `DeviceCommand` protocol;
- a narrow Rust device-adapter boundary;
- SQLite command journaling and an SQLite-backed desk simulator;
- HMAC-signed policy grants bound to one task, command and exact action;
- grant issue/expiry checks, weak-key rejection and station-side verification;
- deterministic `deny` and `require_approval` policy decisions;
- durable task runs, approval ownership/expiry and ordered task timelines;
- safe-envelope and stale-state checks at both policy and device seams;
- persist-before-effect execution and read-after-write verification;
- idempotent replay without a second physical effect;
- fault injection for “effect happened, acknowledgement was lost”;
- restart reconciliation with an ordered command-event timeline.

Run the complete scenario from the repository root:

```bash
pnpm demo
pnpm demo:approval
```

Run the verification suite:

```bash
pnpm test
pnpm check
pnpm lint
```

The demos intentionally have no LLM dependency: their tasks are fixed so that
execution, approval and recovery semantics can be tested deterministically. The
next vertical slice exposes `TaskRunView` through Hono and renders its policy,
approval and event timeline in the TanStack Start console. Mastra planning is
attached only after that deterministic control path is reliable.

Key modules:

- `crates/ergopilot-protocol`: shared versioned command and event types;
- `crates/policy-core`: deterministic decisions plus signed grant issue and
  verification;
- `crates/station-core`: validation, journal, execution, verification and
  reconciliation;
- `crates/task-runtime`: durable task/approval state and task-level recovery;
- `crates/device-sim`: persistent simulated hardware plus fault injection;
- `apps/station-cli`: an end-to-end executable demonstration.
