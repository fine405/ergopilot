# ErgoPilot

ErgoPilot is a recoverable embodied-agent runtime for a simulated ergonomic
workstation. It turns a typed work goal into a safe, observable and resumable
desk action while keeping policy and physical execution outside the LLM.

The project is deliberately not a posture chatbot. Its primary engineering
problem is reliable execution against fallible devices:

- semantic capability and versioned task contracts;
- policy-gated actions and durable human approval;
- idempotent local execution and post-action verification;
- crash, disconnect and uncertain-outcome recovery;
- deterministic tests and an inspectable run timeline.

The implementation plan and acceptance criteria are in
[docs/PROJECT_BLUEPRINT.md](docs/PROJECT_BLUEPRINT.md).

## Current vertical slice

The local Rust runtime, Hono API and TanStack Start operator console are
runnable end to end. The current slice implements:

- a strict, shared `TaskSpec` and `TaskRunView` JSON contract;
- an HMAC-signed policy grant bound to one run, command, action and expected
  device-state version;
- deterministic `deny` and `require_approval` decisions;
- durable approval ownership, expiry, run state and ordered events in SQLite;
- persist-before-effect execution, idempotent replay and read-after-write
  verification;
- reconciliation across both task/command dispatch crash windows;
- a bounded JSON process protocol between the TypeScript control plane and the
  Rust station runtime;
- server-owned timestamps and schema validation at the API boundary;
- a responsive operator console for plan inspection, explicit approval,
  station telemetry and evidence-backed completion;
- URL-persisted run selection, so an in-progress approval survives refresh.

The loopback-only control plane currently launches a short-lived
`station-cli --rpc` process for each local request. Every process opens the same
SQLite journal, so the boundary already exercises serialization and
restart-safe state rather than an in-memory mock. The production path will add
authenticated identity and replace this adapter with outbound Tauri/station
connectivity, a Durable Object session and a durable cloud workflow; those
parts are not claimed as implemented yet.

## Run locally

Prerequisites: Rust, Node.js and pnpm.

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000>. The control plane listens on
<http://localhost:8787>. Local development has a non-production policy key;
copy `.env.example` to `.env` when you want to override paths, origins or
credentials. Relative station paths are resolved from the repository root.

The deterministic CLI demos remain available:

```bash
pnpm demo
pnpm demo:approval
```

Run all verification gates:

```bash
pnpm format
pnpm lint
pnpm check
pnpm test
pnpm build
```

The tracer bullet intentionally has no LLM dependency. Its fixed typed task
makes execution, approval, idempotency and recovery behavior reproducible. A
Mastra planner will later translate natural-language intent into the same
validated `TaskSpec`; it will not receive authority over policy or device
execution.

## Stack decisions

- **Rust + SQLite:** authoritative local task, policy and device runtime.
- **Hono on Node.js:** a thin typed control-plane boundary for the local slice.
- **TanStack Start + Query:** routing, reload-safe URL state and server-state
  synchronization for the web console.
- **shadcn/ui:** deterministic product UI such as cards, status, forms and the
  explicit approval dialog.
- **AI Elements, later:** only for actual model-generated explanations, plans
  and AI SDK tool parts after the Mastra planner exists.
- **assistant-ui, deferred:** useful only if multi-thread conversation becomes
  a real product requirement; ErgoPilot remains task-first rather than
  chat-first.
- **Cloudflare + Tauri, planned:** remote coordination and local device access.
  The current process adapter keeps those deployment concerns out of the first
  reliability proof.

## Key modules

- `packages/contracts`: shared Zod schemas and TypeScript types;
- `apps/control-plane`: Hono routes and the bounded Rust process adapter;
- `apps/web`: TanStack Start operator console;
- `apps/station-cli`: JSON RPC boundary and executable recovery demos;
- `crates/ergopilot-protocol`: versioned Rust command and event types;
- `crates/policy-core`: deterministic decisions and signed grants;
- `crates/task-runtime`: durable task/approval state and task-level recovery;
- `crates/station-core`: command journal, execution, verification and
  reconciliation;
- `crates/device-sim`: persistent simulated hardware and fault injection.
