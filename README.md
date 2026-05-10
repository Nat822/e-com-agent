# BitGN Ecom Agent

Competition entry for the [BitGN Agent Challenge: E-commerce](https://bitgn.com/challenge/ecom), opening May 30, 2026.

## Architecture

Adapted from the Operation Pangolin single-tool pattern:

```text
TypeScript runner -> OpenAI-compatible LLM API -> execute_code tool
                                                        |
                                                        v
                                             Python in Docker sandbox
                                             ws.* -> BitGN Workspace API
                                             scratchpad -> persistent JSON
                                             ws.answer() -> structured result
```

The model only gets one tool: `execute_code`. All workspace access, calculations, policy checks, file writes, and final submission happen as Python inside the sandbox. The runner uses a raw OpenAI-compatible chat-completions request against `LLM_API_BASE`, defaulting to `https://api.neuraldeep.ru/v1`.

## Quick Start

```bash
# 1. Install deps
make install

# 2. Configure
# Create .env and set LLM_API_KEY. Set BITGN_API_KEY for live benchmark runs.

# 3. Build sandbox
make build

# 4. Test with local dev tasks
make sandbox
```

## Running Against BitGN

```bash
# Dev bench
make run BENCH=bitgn/ecom1-dev CONCURRENCY=5

# Production blind run
make run-prod MODEL=gpt-oss-120b
```

Direct invocation:

```bash
npx tsx runs/run.ts --bench=bitgn/ecom1-dev --concurrency=5
```

Run only one task:

```bash
npx tsx runs/run.ts --bench=bitgn/ecom1-dev --task=t01 --concurrency=1
```

## Project Structure

```text
agent/
  index.ts            Core LLM loop and execute_code tool dispatch
  system-prompt.ts    Commerce gates, policy rules, and answer discipline
  workspace-client.ts Docker runner, Python bootstrap, ws.answer capture
  bitgn-client.ts     BitGN ConnectRPC run/trial lifecycle client
  logger.ts           Structured JSONL run logging
  types.ts            Shared domain and OpenAI-compatible API types
runs/
  run.ts              CLI entry point and concurrency pool
workspace/            Local dev task/mock workspace files
proto/                BitGN protobuf definitions
ecom-py/              Python reference agent; do not modify by default
Dockerfile            Python sandbox image
Makefile              Common build/run commands
```

## Commerce Gates

The system prompt enforces these gates in order:

1. Policy gate
2. Fraud gate
3. Customer identity gate
4. Payment safety gate
5. Delivery evidence gate
6. Inventory gate
7. Authorization direction gate

## Outcome Codes

| Code | When |
|---|---|
| `OUTCOME_OK` | Task completed successfully, all gates passed |
| `OUTCOME_DENIED_SECURITY` | Fraud, prompt injection, unauthorized override, or unsafe bypass |
| `OUTCOME_NONE_CLARIFICATION` | Ambiguous, incomplete, or policy-silent scenario |
| `OUTCOME_NONE_UNSUPPORTED` | Workspace lacks required capability |
| `OUTCOME_ERR_INTERNAL` | Unrecoverable execution error |

## Current Priorities

Most scoring improvements should happen in `agent/system-prompt.ts`, one gate at a time, after reading failed task logs under `runs/<timestamp>/`.

Before the first real benchmark run:

- Keep `npm run typecheck` passing.
- Create `workspace/dev-tasks.json` for local sandbox testing.
- Verify the BitGN ConnectRPC endpoint and field names against the live harness.
