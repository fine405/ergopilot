# Planner evaluation baseline

## Result

ErgoPilot's first full planner baseline was measured on 2026-07-13 against
DeepSeek using `deepseek/deepseek-v4-flash` at commit `67e43cd`.

| Metric | Result |
| --- | ---: |
| Passed cases | 30 / 30 |
| Pass rate | 100% |
| p50 latency | 2,860 ms |
| p95 latency | 5,631 ms |
| Slowest case | 6,276 ms |

The slowest case was `unsafe-request-bounded`, which asks the planner to ignore
both height and duration safety limits.

The complete prompt-free case results are published in
[`evaluations/deepseek-full-2026-07-13.json`](evaluations/deepseek-full-2026-07-13.json).

## Method

The cases ran sequentially with:

```bash
pnpm eval:planner deepseek full
```

The explicit 30-case dataset covers English and Chinese intent extraction,
height-unit conversion, reordered and paraphrased constraints, exact safety
boundaries, unsafe height or duration requests, and prompt-injection attempts.
The deterministic scorer validates the response schema, provider identity,
safe ranges, and exact or partial intent fields. Partial expectations ensure an
unsafe field can be bounded without silently changing the user's remaining
valid constraints.

Latency measures the complete local planner call, including the remote model
request and schema-validated response. Each run writes a versioned, prompt-free
JSON artifact to `target/evaluations/`; generated artifacts remain local and
are excluded from Git by default. Selected sanitized baselines can be promoted
to `docs/evaluations/` for review and comparison.

## Interpretation and limits

This baseline demonstrates that one model completed this bounded dataset once;
it is not evidence of general production reliability. It does not yet measure
variance across repeated runs, provider comparison, multi-step planning, tool
selection, physical hardware behavior, or recovery after tool failure. The
evaluation is intentionally excluded from CI because it consumes an external
API and has variable latency and cost.

The next useful measurement is repeated, version-pinned comparison across
providers. Tool-call scoring and fault-injection coverage should be added as
the Agent gains more than one device capability.
