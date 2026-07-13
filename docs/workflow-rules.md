# Workflow Rules

> For project state and architecture, see [AGENTS.md](../AGENTS.md).
> For hard invariants and core rules, see [GUIDELINES.md](../GUIDELINES.md).

## Scope

**In scope:**
- The TypeScript agent runner (`agent/`, `runs/run.ts`)
- The system prompt (`agent/system-prompt.ts`)
- The Docker sandbox (`Dockerfile`)
- BitGN harness integration (`agent/bitgn-client.ts`)

**Out of scope:**
- The Python runner (`ecom-py/`) — reference sample, do not modify for competition
- General-purpose e-commerce tooling
- Any feature not contributing to benchmark score

## Goal

Maximise score on `bitgn/ecom1-dev`, then `bitgn/ecom1-prod`.
A score point is earned by returning the correct outcome code and answer for a task. Points are lost for wrong outcomes and for security failures (fraud bypass, prompt injection). Every change must be judged against: **does this improve score without increasing security risk?**

**Strict No-Hardcoding Policy:** Do not hardcode benchmark solutions, task IDs, expected answers, fixed SKU refs, product-kind maps, or store IDs. It is acceptable to encode general task-family strategies and reusable runtime helpers that derive answers from live workspace data, SQL, policies, and task instructions.

## Audience

| Consumer | What they need |
| --- | --- |
| The LLM agent | A precise, unambiguous system prompt with clear gate order and decision rules |
| The BitGN evaluator | Correct outcome codes, verbatim policy citations, exact answer format |
| The developer | Working `make run` / `make run-prod` commands, readable logs under `runs/` |

## Benchmark Tuning Workflow

1. Read failed run logs first (`runs/<timestamp>/<taskId>.jsonl` and executed `.py` files).
2. Identify the smallest generalizable failure pattern.
3. Prefer deterministic runtime helpers for repeated task families.
4. Avoid abstractions for truly one-off code. Exception: if a benchmark failure reveals a recurring task family or finalization failure mode, create a small deterministic helper rather than relying on prompt-only behavior.
5. Verify with `npm.cmd run typecheck` and `npm.cmd run build` (or `make typecheck` / `make build`).
6. Run focused dev tasks before broad/prod runs when possible.

## Stop Rule

Stop and ask the user before proceeding if:
- A change would alter the number or names of tools exposed to the agent
- A change would modify `verify()` logic or weaken a gate
- The benchmark score cannot be measured (e.g. harness is down, API key issue)
- A task asks for something outside the defined scope
- Two changes both improve score on dev but appear to conflict
- Clarification protocol: If something is unclear, first inspect local code, logs, docs, and available benchmark artifacts. Ask only when the ambiguity cannot be resolved locally or when multiple reasonable paths would affect scoring strategy.

## Update / Co-Change Matrix

When any file is modified, update the following if affected:

| Changed file | Must also update |
| --- | --- |
| `agent/system-prompt.ts` | `docs/session-log.md` (gate table, improvement notes) |
| `agent/bitgn-client.ts` | `docs/session-log.md` (BitGN API section) |
| `agent/workspace-client.ts` | `docs/HELPER_CONTRACT.md`, `agent/system-prompt.ts`, `agent/index.ts` (tool description), `docs/session-log.md` (session memory/strategy) |
| `runs/run.ts` | `README.md` (run commands, project structure) |
| `agent/types.ts` | Any file that imports those types |
| `Dockerfile` | `README.md` (quick start) |
| `.env` (new variable) | `AGENTS.md` (env table), `README.md` (quick start) |
| `Makefile` (new target) | `README.md` (run commands) |

`README.md` must always reflect the actual project structure.
