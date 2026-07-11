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

The first local-runtime tracer bullet is runnable. It currently implements:

- a versioned `DeviceCommand` protocol;
- a narrow Rust device-adapter boundary;
- SQLite command journaling and an SQLite-backed desk simulator;
- local policy-grant, expiry, safe-envelope and stale-state checks;
- persist-before-effect execution and read-after-write verification;
- idempotent replay without a second physical effect;
- fault injection for “effect happened, acknowledgement was lost”;
- restart reconciliation with an ordered command-event timeline.

Run the complete scenario from the repository root:

```bash
pnpm demo
```

Run the verification suite:

```bash
pnpm test
pnpm check
```

The demo intentionally has no LLM dependency: its task is fixed so that the
execution and recovery semantics can be tested deterministically. The next
vertical slice adds the task/policy approval state machine and a web timeline;
Mastra planning is attached only after those boundaries are reliable.

Key modules:

- `crates/ergopilot-protocol`: shared versioned command and event types;
- `crates/station-core`: validation, journal, execution, verification and
  reconciliation;
- `crates/device-sim`: persistent simulated hardware plus fault injection;
- `apps/station-cli`: an end-to-end executable demonstration.
