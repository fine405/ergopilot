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
- an explicit demo-only ACK-loss path that proves reconciliation does not
  repeat a physical effect;
- a bounded JSON process protocol between the TypeScript control plane and the
  Rust station runtime;
- an optional Mastra planner that converts natural language into a bounded,
  server-validated `TaskSpec` without receiving execution authority;
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

Prerequisites: Rust, Node.js 22.13 or newer, and pnpm.

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000>. The control plane listens on
<http://localhost:8787>. Local development has a non-production policy key;
copy `.env.example` to `.env` when you want to override paths, origins or
credentials. Relative station paths are resolved from the repository root.
Planner attempts are atomically persisted to
`target/ergopilot-planner-attempts.json` by default, so the latest 100 traces
survive a control-plane restart. Override the path with
`ERGOPILOT_PLANNER_ATTEMPTS_PATH`.
Set `OPENAI_API_KEY`, `DEEPSEEK_API_KEY` or both in `.env` to enable the
matching Mastra planner providers. The provider selector shows missing-key
providers as disabled. Without either key, the deterministic task builder and
complete execution path remain usable.

To exercise uncertain-outcome recovery in the operator console, create a
manual task, open **Review & approve**, choose **Approve + lose ACK (demo)**,
then click **Reconcile state**. The run moves through `outcome_unknown` to
`completed`, while the station movement count increases only once.

The deterministic CLI demos remain available:

```bash
pnpm demo
pnpm demo:approval
```

Run the optional six-case live planner smoke evaluation against a configured
provider. The command makes real API calls, saves a prompt-free JSON report to
`target/evaluations/`, and is not part of CI:

```bash
pnpm eval:planner deepseek
```

Pass `full` explicitly to run the 30-case suite:

```bash
pnpm eval:planner deepseek full
```

See the measured methodology, results and limitations in
[`docs/PLANNER_EVALUATION.md`](docs/PLANNER_EVALUATION.md).

Run all verification gates:

```bash
pnpm format
pnpm lint
pnpm check
pnpm test
pnpm build
```

The execution tracer bullet intentionally retains no LLM dependency. Its fixed
typed task keeps approval, idempotency and recovery behavior reproducible. The
optional Mastra planner now translates natural-language intent into the same
validated `TaskSpec`; generated plans require explicit confirmation and never
receive authority over policy or device execution.

## Stack decisions

- **Rust + SQLite:** authoritative local task, policy and device runtime.
- **Hono + Mastra on Node.js:** a typed control-plane boundary plus optional
  OpenAI or DeepSeek structured planning.
- **TanStack Start + Query:** routing, reload-safe URL state and server-state
  synchronization for the web console.
- **shadcn/ui:** deterministic product UI such as cards, status, forms and the
  explicit approval dialog.
- **AI Elements, selectively:** the `Task` element renders generated plans;
  deterministic forms, approval and device state remain shadcn/ui.
- **assistant-ui, deferred:** useful only if multi-thread conversation becomes
  a real product requirement; ErgoPilot remains task-first rather than
  chat-first.
- **Cloudflare + Tauri, planned:** remote coordination and local device access.
  The current process adapter keeps those deployment concerns out of the first
  reliability proof.

## Key modules

- `packages/contracts`: shared Zod schemas and TypeScript types;
- `apps/control-plane`: Hono routes, Mastra planner and bounded Rust process
  adapter;
- `apps/web`: TanStack Start operator console;
- `apps/station-cli`: JSON RPC boundary and executable recovery demos;
- `crates/ergopilot-protocol`: versioned Rust command and event types;
- `crates/policy-core`: deterministic decisions and signed grants;
- `crates/task-runtime`: durable task/approval state and task-level recovery;
- `crates/station-core`: command journal, execution, verification and
  reconciliation;
- `crates/device-sim`: persistent simulated hardware and fault injection.
