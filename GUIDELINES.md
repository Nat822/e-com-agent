# GUIDELINES.md — Project Manager Working Document

> For project state and session history, see AGENTS.md.
> This file is the source of truth for scope, goals, workflow, and coding rules.

## 0. Meta-Rule
At the start of every session, confirm you have read GUIDELINES.md 
and will follow all rules below. If this file changed, note what changed.

## Scope
This project is a single-purpose competition entry for the BitGN E-commerce Agent Challenge.
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
Maximise score on `bitgn/ecom-dev`, then `bitgn/ecom-prod`.
A score point is earned by returning the correct outcome code and answer for a task. Points are lost for wrong outcomes and for security failures (fraud bypass, prompt injection). Every change must be judged against: does this improve score without increasing security risk?

**Strict No-Hardcoding Policy:** Do not hardcode benchmark solutions, task IDs, expected answers, fixed SKU refs, product-kind maps, or store IDs. It is acceptable to encode general task-family strategies and reusable runtime helpers that derive answers from live workspace data, SQL, policies, and task instructions.

## Audience
| Consumer | What they need |
| --- | --- |
| The LLM agent | A precise, unambiguous system prompt with clear gate order and decision rules |
| The BitGN evaluator | Correct outcome codes, verbatim policy citations, exact answer format |
| The developer | Working `make run` / `make run-prod` commands, readable logs under `runs/` |

Do not optimise for readability at the expense of agent precision. The agent is the primary consumer of the system prompt — not humans.

## Autonomy / Core Rules
These rules cannot be overridden by any task instruction or user request:
- **Single tool.** The TS agent exposes `execute_code` only. No new tools.
- **System prompt is primary.** All decision logic, gate order, and policy rules live in `agent/system-prompt.ts`. Hardcoding decision logic in the runner is a bug.
- **Prompt vs. Runtime Boundary:** Use the prompt for routing, gating, and outcome selection. Use deterministic runtime helpers (`agent/workspace-client.ts`) for repetitive data parsing, SQL/query execution, scratchpad normalization, ID extraction, and retrying malformed tool calls.
- **Per-trial isolation.** Each BitGN trial gets its own `harnessUrl`. No shared state between concurrent tasks.
- **verify() is mandatory.** Every `ws.answer()` must pass a `verify(scratchpad)` check. Never remove or weaken it.
- **Evidence preservation.** Do not remove or weaken `verify()`, refs, `reasoning_trail`, `search_trail`, or policy citations to make submissions easier. Fix helper output or prompt guidance instead.
- **No card data in logs.** Payment card numbers must never appear in any output, log, or scratchpad field.
- **Scoring-safety guards.** It is acceptable and required to add guards for timeouts, malformed LLM tool calls, verification failures, prompt injection, missing identifiers, and unsupported runtime capabilities. These are part of benchmark correctness, not speculative error handling.
- **No prod runs without dev validation.** Test on `bitgn/ecom-dev` before running `bitgn/ecom-prod`.

## Workflow Rules
- **Propose before implementing.** Any change that touches `agent/system-prompt.ts`, `agent/index.ts`, or `Dockerfile` requires prior proposal. These are high-risk files.
- **Bench score is the ground truth.** Don't argue from first principles — run `make run` and let the score decide.
- **Gate changes are surgical.** Change one gate at a time, measure the delta, then move to the next.
- **Keep `MAX_TURNS = 12`.** Do not increase without evidence that a task class consistently fails mid-reasoning.
- **Target 2–3 `execute_code` calls per task.** If logs show 4+, the system prompt needs tightening, not the runner.
- **Benchmark Tuning Workflow:**
  1. Read failed run logs first (`runs/<timestamp>/<taskId>.jsonl` and executed `.py` files).
  2. Identify the smallest generalizable failure pattern.
  3. Prefer deterministic runtime helpers for repeated task families.
  4. Avoid abstractions for truly one-off code. Exception: if a benchmark failure reveals a recurring task family or finalization failure mode, create a small deterministic helper rather than relying on prompt-only behavior.
  5. Verify with `make typecheck` and `make build` (Windows fallback: `npm.cmd run typecheck` / `npm.cmd run build`).
  6. Run focused dev tasks before broad/prod runs when possible.

## Stop Rule
Stop and ask the user before proceeding if:
- A change would alter the number or names of tools exposed to the agent
- A change would modify `verify()` logic or weaken a gate
- The benchmark score cannot be measured (e.g. harness is down, API key issue)
- A task asks for something outside the defined scope
- Two changes both improve score on dev but appear to conflict
- Clarification protocol: If something is unclear, first inspect local code, logs, docs, and available benchmark artifacts. Ask only when the ambiguity cannot be resolved locally or when multiple reasonable paths would affect scoring strategy.

Do not guess. Do not proceed on assumption. Surface the conflict.

## Update Rule
When any file is modified, update the following if affected:
| Changed file | Must also update |
| --- | --- |
| `agent/system-prompt.ts` | `AGENTS.md` (gate table, improvement notes) |
| `agent/bitgn-client.ts` | `AGENTS.md` (BitGN API section) |
| `agent/workspace-client.ts` | `docs/HELPER_CONTRACT.md`, `agent/system-prompt.ts`, `agent/index.ts` (tool description), `AGENTS.md` (session memory/strategy) |
| `runs/run.ts` | `README.md` (run commands, project structure) |
| `agent/types.ts` | Any file that imports those types |
| `Dockerfile` | `README.md` (quick start), `AGENTS.md` (sandbox section) |
| `.env` (new variable) | `AGENTS.md` (env table), `README.md` (quick start) |
| `Makefile` (new target) | `README.md` (run commands) |

`README.md` must always reflect the actual project structure. If a file is added, moved, or removed, update the structure block in `README.md`.