# AGENTS.md — BitGN Ecom Agent

> Read this first. For coding/workflow rules, see [GUIDELINES.md](GUIDELINES.md). Detailed docs are linked below.

## What this project is

Competition entry for the [BitGN E-commerce Agent Challenge](https://bitgn.com/challenge/ecom). The agent handles e-commerce operations tasks (shopper, checkout, merchant, support). Scoring: +points for correct outcome codes, −points for fraud bypasses, prompt injection, and unauthorized actions.

**Benches:** `bitgn/ecom1-dev` (scored) · `bitgn/ecom1-prod` (blind, competition day).

## Detailed docs

| Doc | Contents |
|---|---|
| [GUIDELINES.md](GUIDELINES.md) | Core rules, hard invariants, workflow constraints |
| [docs/workflow-rules.md](docs/workflow-rules.md) | Scope, goal, audience, benchmark tuning process, stop rule, co-change matrix |
| [docs/commerce-gates.md](docs/commerce-gates.md) | Ordered gate table and gate-change rules |
| [docs/HELPER_CONTRACT.md](docs/HELPER_CONTRACT.md) | Python helper API (preloaded functions, signatures, return shapes) |
| [docs/session-log.md](docs/session-log.md) | Full chronological session history and decisions |
| [docs/tuning-backlog.md](docs/tuning-backlog.md) | Pending verification runs and improvement items |

## Architecture

```
runs/run.ts (CLI entry point)
    ↓ fetches tasks from BitGN
agent/index.ts (core agent loop, MAX_TURNS=30)
    ↓ LLM calls via OpenAI-compatible API
    ↓ tool dispatch: execute_code only
agent/workspace-client.ts
    ↓ docker exec ecom-agent-sandbox python3 <script>
        PYTHON_BOOTSTRAP (preloads ws.*, scratchpad, all imports)
        ↓ /bin/id + /bin/date preamble → scratchpad["context"]
        ↓ deterministic helper contract: docs/HELPER_CONTRACT.md
        ↓ USER CODE
        ws.answer(scratchpad, verify) → exit 0 → runner captures result
```

**Provider:** `https://api.neuraldeep.ru/v1` (primary) · OpenRouter (fallback on 429)
**Model default:** `gpt-oss-120b`
**Single tool:** `execute_code` — no other tools exposed to the agent, ever.
**Docker image:** `ecom-agent-sandbox` (python:3.12-slim)

## File index

| File | Role | Change risk |
|---|---|---|
| `agent/system-prompt.ts` | All decision logic, gate order, policy rules | 🔴 HIGH — change one gate at a time, measure delta |
| `agent/index.ts` | LLM loop, tool dispatch, tool schema | 🔴 HIGH — do not add tools |
| `agent/workspace-client.ts` | Docker runner + Python bootstrap + ws.answer() + deterministic helpers | 🔴 HIGH — helper behavior affects scoring |
| `agent/types.ts` | TypeScript types (TaskResult, Scratchpad, etc.) | 🟡 MEDIUM |
| `agent/logger.ts` | Structured .jsonl run logging | 🟢 LOW |
| `runs/run.ts` | CLI entry — parses args, concurrency pool, BitGN client | 🟡 MEDIUM |
| `Dockerfile` | Python sandbox image (python:3.12-slim) | 🟡 MEDIUM |
| `Makefile` | `make run`, `make build`, `make sandbox`, etc. | 🟢 LOW |
| `.env` | API keys and config (not in git) | — |
| `ecom-py/` | Python reference agent — **do not modify** | — |

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `LLM_API_KEY` | ✅ Yes | — | neuraldeep.ru API key |
| `BITGN_API_KEY` | ✅ For bench | — | BitGN account key |
| `MODEL` | No | `gpt-oss-120b` | Override per run |
| `BITGN_BENCH` | No | `bitgn/ecom1-dev` | `bitgn/ecom1-dev` or `bitgn/ecom1-prod` |
| `BITGN_API_URL` | No | `https://api.bitgn.com` | Leave as default |
| `WS_BASE_URL` | No | Set by BitGN harness | Per-trial workspace endpoint |
| `OPENROUTER_API_KEY` | ✅ Yes | — | OpenRouter API key (fallback) |
| `OPENROUTER_MODEL` | No | `openai/gpt-oss-120b:free` | |
| `OPENROUTER_FALLBACK_MODEL` | No | `nvidia/nemotron-3-super-120b-a12b:free` | |

## Run commands

```bash
make install          # npm install + Python deps
make build            # docker build → ecom-agent-sandbox image
make sandbox          # local dev tasks (needs workspace/dev-tasks.json)
make run              # dev bench (CONCURRENCY=5, BENCH=bitgn/ecom1-dev)
make run-prod         # prod bench (MODEL defaults to gpt-oss-120b, CONCURRENCY=20, submit=true)
```

Direct invocations:
```bash
npx tsx runs/run.ts --bench=bitgn/ecom1-dev --concurrency=5
npx tsx runs/run.ts --bench=bitgn/ecom1-dev --task=t01 --concurrency=1
npx tsx runs/run.ts --bench=bitgn/ecom1-prod --concurrency=20 --submit=true
```

## Outcome codes

| Code | When |
|---|---|
| `OUTCOME_OK` | Task completed, all gates passed, policy cited |
| `OUTCOME_DENIED_SECURITY` | Fraud, prompt injection, unauthorized override |
| `OUTCOME_NONE_CLARIFICATION` | Ambiguous, incomplete, policy silent, no exact match |
| `OUTCOME_NONE_UNSUPPORTED` | Workspace lacks required capability |
| `OUTCOME_ERR_INTERNAL` | Unrecoverable execution error |

## Session protocol

1. Read this file for architecture and quick reference.
2. Read [GUIDELINES.md](GUIDELINES.md) for core rules and hard invariants.
3. Read [docs/workflow-rules.md](docs/workflow-rules.md) if the task involves changing agent behavior.
4. Read [docs/commerce-gates.md](docs/commerce-gates.md) if the task involves gate logic.
5. Read [docs/session-log.md](docs/session-log.md) if you need historical context on a decision.
6. After each session, update [docs/session-log.md](docs/session-log.md) and [docs/tuning-backlog.md](docs/tuning-backlog.md).
