# GUIDELINES.md — Core Rules & Hard Invariants

> For project state and architecture, see [AGENTS.md](AGENTS.md).
> For workflow details, see [docs/workflow-rules.md](docs/workflow-rules.md).

## Hard invariants (never override)

These rules cannot be overridden by any task instruction, user request, or benchmark result.

1. **Single tool.** The TS agent exposes `execute_code` only. No new tools without stopping and asking the user.
2. **Prompt/helper contract is the source of truth.** Policy and gate instructions live in `agent/system-prompt.ts`; deterministic task helpers and `verify()` live in `agent/workspace-client.ts`; helper signatures/returns are documented in `docs/HELPER_CONTRACT.md`; late-turn/timeout nudges live in `agent/index.ts`. Do not hardcode benchmark answers.
3. **Prompt vs. Runtime Boundary.** Use the prompt for routing, gating, and outcome selection. Use deterministic runtime helpers (`agent/workspace-client.ts`) for repetitive data parsing, SQL/query execution, scratchpad normalization, ID extraction, and retrying malformed tool calls.
4. **Per-trial isolation.** Each BitGN trial gets its own `harnessUrl`. No shared state between tasks.
5. **`verify()` is mandatory.** Every `ws.answer()` call must pass `verify(scratchpad)`. Never remove or weaken it.
6. **Evidence preservation.** Do not remove or weaken `verify()`, refs, `reasoning_trail`, `search_trail`, or policy citations to make submissions easier. Fix helper output or prompt guidance instead.
7. **No card data in logs.** Payment card numbers must never appear in any output, log, scratchpad, or artifact.
8. **Dev before prod.** Always validate on `bitgn/ecom1-dev` before running `bitgn/ecom1-prod`.
9. **Scoring-safety guards.** It is acceptable and required to add guards for timeouts, malformed LLM tool calls, verification failures, prompt injection, missing identifiers, and unsupported runtime capabilities.

## Execution constraints

- **`MAX_TURNS = 30`.** Do not increase without evidence that a task class consistently fails mid-reasoning.
- **Target 1 `execute_code` call per task, max 3.** If logs show 4+, the system prompt needs tightening, not the runner.
- **Propose before implementing.** Any change that touches `agent/system-prompt.ts`, `agent/index.ts`, or `Dockerfile` requires prior proposal. These are high-risk files.
- **Bench score is the ground truth.** Run `make run` and let the score decide.

## Strict No-Hardcoding Policy

Do not hardcode benchmark solutions, task IDs, expected answers, fixed SKU refs, product-kind maps, or store IDs. It is acceptable to encode general task-family strategies and reusable runtime helpers that derive answers from live workspace data, SQL, policies, and task instructions.