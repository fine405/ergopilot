# ErgoPilot

ErgoPilot is a recoverable embodied-agent runtime for a simulated ergonomic
workstation. It turns a typed work goal into a safe, observable and resumable
workstation action while keeping policy and physical execution outside the
LLM.

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

The local Rust runtime, Hono API, TanStack Start operator console and Tauri
desktop station are runnable end to end. The current slice implements:

- a strict, shared `TaskSpec` and `TaskRunView` JSON contract;
- an HMAC-signed policy grant bound to one run, command, action and expected
  device-state version;
- deterministic `deny` and `require_approval` decisions;
- durable approval ownership, expiry, run state and ordered events in SQLite;
- requester-scoped cancellation of pending approvals, atomically serialized
  against approval so a cancelled run cannot dispatch a device command;
- persist-before-effect execution, idempotent replay and read-after-write
  verification;
- reconciliation across both task/command dispatch crash windows;
- an explicit demo-only ACK-loss path that proves reconciliation does not
  repeat a physical effect;
- a demo-only device-offline path that fails before effect and requires a
  fresh run instead of a blind retry;
- a structured pre-dispatch device-unavailable path that suspends safely and
  resumes the same run through a dedicated operator action; each attempt is
  atomically persisted before device access, capped at three, and completed
  with durable `run_resumed` evidence, while uncertain outcomes keep a
  separate reconciliation path;
- persisted suspension reasons that distinguish recoverable device
  unavailability from stale station state and expired authorization;
- a bounded JSON process protocol between the TypeScript control plane and the
  Rust station runtime;
- stable station RPC error codes that preserve caller, authorization, task
  state, availability and transport semantics through the Hono API;
- an optional Mastra planner that converts natural language into a bounded,
  server-validated `TaskSpec` without receiving execution authority;
- server-owned timestamps and schema validation at the API boundary;
- a versioned capability catalog shared by the control plane and a local MCP
  server;
- permission-bounded MCP tools that can query state, inspect runs and create a
  pending proposal, but cannot approve or directly execute physical motion;
- typed desk-height and smart-chair lumbar-support actions with independent
  safety envelopes, approval rules and verified simulator state;
- an ordered `restore_profile` task that turns one approved Chat request into
  a persisted desk-height command followed by a lumbar-support command;
- a Three.js digital twin whose desk actuator and chair lumbar pad follow Rust
  telemetry, with Rapier providing visual gravity and collision simulation;
- a Tauri 2 desktop host that embeds the same TanStack UI while keeping the
  station database and policy signing key behind one typed Rust IPC command;
- a responsive operator console for plan inspection, explicit approval,
  station telemetry and evidence-backed completion;
- URL-persisted run selection, so an in-progress approval survives refresh.

The Web control plane launches a short-lived `station-cli --rpc` process for
each local station request. The desktop build instead invokes the same Rust
runtime in process through Tauri and stores its SQLite journal and generated
policy key in the OS application-data directory. Natural-language planning is
still delegated to the loopback Hono service in this slice. Authenticated
remote coordination, a Durable Object session and a durable cloud workflow
remain future work.

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

For the shortest Chat-to-device demo, use a request such as: **Set the desk to
790 mm and lumbar support to 65% for a 45 minute focus session. Only interrupt
me for critical issues.** Review the generated two-step `TaskSpec`, create the
protected run, then approve the two ordered motions once. The Three.js twin
previews both targets before approval and follows the verified Rust simulator
state after execution.

### Run the desktop station

The desktop UI is the same TanStack/Three.js application, but station and task
operations use local Tauri IPC instead of HTTP. Start the Hono service for the
optional OpenAI/DeepSeek planner in one terminal:

```bash
cargo build -p station-cli
pnpm --filter @ergopilot/control-plane dev
```

Then start the desktop app in a second terminal:

```bash
pnpm desktop:dev
```

`desktop:dev` owns port 3000 for its Vite UI, so do not run `pnpm dev` at the
same time. A missing planner service does not remove local station authority,
but provider discovery and natural-language planning will be unavailable.

Build the current unsigned local executable with:

```bash
pnpm desktop:build
```

On macOS the binary is
`apps/station/src-tauri/target/release/ergopilot-station`. Tauri keeps
`ergopilot-station.sqlite` and `policy.key` in its application-data directory
(normally `~/Library/Application Support/com.ergopilot.station/` on macOS),
not in the Web UI or environment variables. Create and approve a manual task,
close the app, and reopen it to verify that the station snapshot persists. The
automated restart test also proves that a pending task can be approved by a
new desktop-host instance:

```bash
pnpm --filter @ergopilot/station test
```

To exercise uncertain-outcome recovery in the operator console, create a
manual task, open **Review & approve**, choose **Approve + lose ACK (demo)**,
then click **Reconcile state**. The run moves through `outcome_unknown` to
`completed`, while the station movement count increases only once.

To exercise a definite pre-effect failure, choose **Approve + device offline
(demo)**. The station command has already been journaled, so the run becomes
`failed`, the timeline records `execution_failed`, and the movement count stays
at zero. Create a fresh task run after the simulated device returns, then use
normal approval to complete one movement.

To exercise recoverable pre-dispatch unavailability, choose **Approve +
unavailable before dispatch (demo)**. The run becomes `suspended` before a
station command is journaled, exposes `device_unavailable` as its suspension
reason, and keeps the movement count at zero. Click **Resume run** after
connectivity is safe; the same run completes, clears the reason, and the total
movement count becomes one. The runtime accepts this dedicated resume action
only for `device_unavailable`; runs suspended for `stale_state` or `expired`
require a fresh run against current state. Unknown physical outcomes continue
through **Reconcile state** instead.

To exercise cancellation, create a task and choose **Cancel run** before
approval. The run becomes `cancelled`, records `run_cancelled`, and remains
cancelled across restarts without creating a command or moving the simulated
desk. Cancellation is intentionally limited to `awaiting_approval`; once a
command can be in flight, the runtime refuses to claim cancellation until a
device-side execution/cancel arbitration protocol exists.

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

The local stdio MCP server expects the control plane to be running. It exposes
`workstation.list_capabilities`, `workstation.get_state`,
`workstation.propose_desk_motion`, `workstation.propose_lumbar_support` and
`workstation.inspect_run`. Start it with stdout reserved for MCP protocol
traffic:

```bash
ERGOPILOT_CONTROL_PLANE_URL=http://localhost:8787 \
  pnpm --silent --filter @ergopilot/mcp-server start
```

When configuring an MCP client, use the repository root as its working
directory and the same command/arguments. Approval remains available only in
the trusted operator UI; the MCP server intentionally has no approval tool.

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
- **Three.js + Rapier:** a browser digital twin renders verified or pending
  device state and adds visual-only rigid-body physics; Rust remains the
  authoritative device state.
- **assistant-ui, deferred:** useful only if multi-thread conversation becomes
  a real product requirement; ErgoPilot remains task-first rather than
  chat-first.
- **Tauri 2:** implemented local desktop boundary for the same operator UI,
  with Rust-owned SQLite, policy key and task lifecycle.
- **Cloudflare, planned:** authenticated remote coordination and durable cloud
  workflow remain outside the current local reliability proof.

## Key modules

- `packages/contracts`: shared Zod schemas and TypeScript types;
- `apps/control-plane`: Hono routes, Mastra planner and bounded Rust process
  adapter;
- `apps/mcp-server`: stdio MCP tools over the existing control-plane contract;
- `apps/web`: TanStack Start operator console;
- `apps/station`: Tauri desktop host and local Rust IPC boundary;
- `apps/station-cli`: JSON RPC boundary and executable recovery demos;
- `crates/ergopilot-protocol`: versioned Rust command and event types;
- `crates/policy-core`: deterministic decisions and signed grants;
- `crates/task-runtime`: durable task/approval state and task-level recovery;
- `crates/station-core`: command journal, execution, verification and
  reconciliation;
- `crates/device-sim`: persistent simulated hardware and fault injection.
