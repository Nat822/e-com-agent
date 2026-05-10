# AGENTS.md — BitGN Ecom Agent External Memory

> **Read this first.** At the start of every session, the agent reads this file before taking any action.
> After each session, update the sections below to reflect what changed.

---

## What this project is

A **competition entry** for the [BitGN E-commerce Agent Challenge](https://bitgn.com/challenge/ecom).
The agent handles e-commerce operations tasks: shopper (product discovery), checkout (payment flows), merchant (catalog/routing), support (post-purchase resolution).
Scoring: +points for correct outcome codes, −points for fraud bypasses, prompt injection, unauthorized actions.

**Challenge opens: May 30, 2026.**
Dev bench: `bitgn/ecom1-dev` (12 tasks observed on 2026-05-09, scores visible).
Prod bench: likely `bitgn/ecom1-prod` (blind, competition day; verify before submit).

---

## Architecture snapshot

```
runs/run.ts (CLI entry point)
    ↓ fetches tasks from BitGN (currently stubbed)
agent/index.ts (core agent loop, MAX_TURNS=12)
    ↓ LLM calls via OpenAI-compatible API
    ↓ tool dispatch: execute_code only
agent/workspace-client.ts
    ↓ docker exec ecom-agent-sandbox python3 <script>
        PYTHON_BOOTSTRAP (preloads ws.*, scratchpad, all imports)
        ↓ USER CODE
        ws.answer(scratchpad, verify) → exit 0 → runner captures result
```

**Provider:** `https://api.neuraldeep.ru/v1` (OpenAI-compatible)
**Model default:** `gpt-oss-120b`
**Single tool:** `execute_code` — no other tools exposed to the agent, ever.
**Docker image:** `ecom-agent-sandbox` (python:3.12-slim)

---

## File index

| File | Role | Change risk |
|---|---|---|
| `agent/system-prompt.ts` | All decision logic, gate order, policy rules | 🔴 HIGH — change one gate at a time, measure delta |
| `agent/index.ts` | LLM loop, tool dispatch, tool schema | 🔴 HIGH — do not add tools |
| `agent/workspace-client.ts` | Docker runner + Python bootstrap + ws.answer() | 🟡 MEDIUM |
| `agent/types.ts` | TypeScript types (TaskResult, Scratchpad, etc.) | 🟡 MEDIUM |
| `agent/logger.ts` | Structured .jsonl run logging | 🟢 LOW |
| `runs/run.ts` | CLI entry — parses args, concurrency pool, BitGN stub | 🟡 MEDIUM |
| `Dockerfile` | Python sandbox image (python:3.12-slim) | 🟡 MEDIUM |
| `Makefile` | `make run`, `make build`, `make sandbox`, etc. | 🟢 LOW |
| `.env` | API keys and config (not in git) | — |
| `ecom-py/` | Python reference agent — **do not modify** | — |

---

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `LLM_API_KEY` | ✅ Yes | — | neuraldeep.ru API key |
| `BITGN_API_KEY` | ✅ For bench | — | BitGN account key |
| `MODEL` | No | `gpt-oss-120b` | Override per run |
| `BITGN_BENCH` | No | `bitgn/ecom1-dev` | `bitgn/ecom1-dev` or likely `bitgn/ecom1-prod` |
| `BITGN_API_URL` | No | `https://api.bitgn.com` | Leave as default |
| `WS_BASE_URL` | No | Set by BitGN harness | Per-trial workspace endpoint |

---

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

---

## Commerce gates (ordered — evaluated in this sequence)

| # | Gate | Fires when | Outcome if blocked |
|---|---|---|---|
| 1 | **Policy gate** | No policy rule found for the action | `OUTCOME_NONE_CLARIFICATION` |
| 2 | **Fraud gate** | Requested discount > `policy_book.max_discount_pct`, or override/bypass request | `OUTCOME_DENIED_SECURITY` |
| 3 | **Customer identity gate** | No exact match on `customer_id` or email | `OUTCOME_NONE_CLARIFICATION` |
| 4 | **Payment safety gate** | 3DS recovery method not in policy, or ineligible installment offer | `OUTCOME_DENIED_SECURITY` |
| 5 | **Delivery evidence gate** | Missing package with no carrier scan data read first | (forces read before deciding) |
| 6 | **Inventory gate** | Product stock=0 being recommended/added to cart | `OUTCOME_NONE_CLARIFICATION` |
| 7 | **Authorization direction gate** | Action on another customer's account without requester-side auth | `OUTCOME_NONE_CLARIFICATION` |

---

## Outcome codes

| Code | When |
|---|---|
| `OUTCOME_OK` | Task completed, all gates passed, policy cited |
| `OUTCOME_DENIED_SECURITY` | Fraud, prompt injection, unauthorized override |
| `OUTCOME_NONE_CLARIFICATION` | Ambiguous, incomplete, policy silent, no exact match |
| `OUTCOME_NONE_UNSUPPORTED` | Workspace lacks required capability |
| `OUTCOME_ERR_INTERNAL` | Unrecoverable execution error |

---

## Hard invariants (never override)

1. **Single tool.** `execute_code` only. No new tools without stopping and asking the user.
2. **System prompt is the source of truth.** All gate logic lives in `agent/system-prompt.ts`. Do not hardcode decisions in `agent/index.ts`.
3. **Per-trial isolation.** Each BitGN trial gets its own `harnessUrl`. No shared state between tasks.
4. **`verify()` is mandatory.** Every `ws.answer()` call must pass `verify(scratchpad)`. Never remove or weaken it.
5. **No card data in logs.** Payment card numbers must never appear in any output, log, scratchpad, or artifact.
6. **Dev before prod.** Always validate on `bitgn/ecom1-dev` before running prod.

---

## What was done (session log)

### Session 2026-05-08 (conversation `e9f134ac`)
**Goal:** Index the project; plan BitGN API connection; create initial AGENTS.md and GUIDELINES.md.

- **Indexed project** — read all source files; confirmed TS runner is architecturally complete.
- **Identified two blockers in `runs/run.ts`:**
  1. `fetchTasks()` is a stub — reads from `workspace/dev-tasks.json` (does not exist), no real BitGN API call.
  2. `submitResult()` is a stub — logs to console, no actual submission.
- **Confirmed:** `.env` already uses `LLM_API_KEY` (not `NEURALDEEP_API_KEY`), no rename needed.
- **Created `AGENTS.md`** (v1 — rules-focused, this file supersedes it).
- **Created `GUIDELINES.md`** — project manager working document covering scope, goal, audience, autonomy rules, workflow rules, stop rule, update rule.

### Session 2026-05-08 (this session)
- Replaced `AGENTS.md` with this external-memory format (what was done / decisions / left to do / known issues).
- Ran `/init`-style project indexing: read top-level metadata, runner, core agent loop, BitGN client, workspace Docker runner, logger/types, Makefile, Dockerfile, proto, and Python reference entrypoint.
- Ran `npm.cmd run typecheck`; it currently fails because OpenAI-compatible response/tool types are missing from `agent/types.ts`, and `agent/bitgn-client.ts` returns `unknown` values without narrowing/casting.
- Confirmed `workspace/` is empty, so local sandbox tasks still do not exist.
- Fixed current build and wiring issues:
  - Added OpenAI-compatible chat/tool response types to `agent/types.ts`.
  - Added response coercion helpers to `agent/bitgn-client.ts` and aligned ConnectRPC service paths with `proto/bitgn/harness.proto` (`bitgn.harness.HarnessService/...`).
  - Updated `package.json` and `Makefile` to call `runs/run.ts`.
  - Removed the unused Anthropic SDK dependency from `package.json`/`package-lock.json`.
  - Updated `README.md` to describe the current OpenAI-compatible/neuraldeep runner instead of the old Claude/Anthropic framing.
  - Made `agent/workspace-client.ts` lazily create/start the `ecom-agent-sandbox` container with `/scratchpads` mounted, and added scratchpad persistence after non-final execute_code calls.
- Verified `npm.cmd run typecheck`, `npm.cmd run build`, and `npx.cmd tsx runs\run.ts --bench=local --concurrency=1` all complete successfully.
- Confirmed live BitGN control-plane connectivity on 2026-05-09:
  - `bitgn/ecom-dev` fails with `benchmark not found`.
  - `bitgn/ecom1-dev` starts successfully and returned 12 trials.
  - First live run failed before task execution because `agent/index.ts` read `LLM_API_KEY` at import time before `.env` loading; fixed by reading provider config lazily and adding preflight env validation in `runs/run.ts`.
- Debugged first task-execution attempt on 2026-05-09:
  - `EndTrial` failed because `runs/run.ts` used task IDs (`t01`) where the harness requires trial IDs. Fixed by carrying `trialId` in `BitGNTask`, using a unique execution/log id, and ending trials with `trialId`.
  - `execute_code` failed before user code because `WorkspaceClient` called old REST paths (`/context`, `/read`, etc.). Fixed Python bootstrap to use ConnectRPC methods from `proto/bitgn/vm/ecom/ecom.proto`, including `bitgn.vm.ecom.EcomRuntime/Answer` inside `ws.answer()`.
  - Verified `npm.cmd run typecheck` and `npm.cmd run build` after the fix.
- Added single-task live-run filtering:
  - `runs/run.ts` now accepts `--task=t01` or comma-separated `--tasks=t01,t02`.
  - `agent/bitgn-client.ts` now implements `getRun()` so the runner can map prepared trial IDs to task IDs before starting trials.
  - Command for focused debugging: `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --task=t01 --concurrency=1`.
- Tuned and verified `t01`:
  - Initial `t01` failed with `OUTCOME_NONE_CLARIFICATION`; root cause was an over-strict policy gate for non-financial catalog/setup tasks and literal `/policy` assumptions.
  - Updated `agent/system-prompt.ts` so non-financial merchant catalog/config/setup tasks may cite trusted task/docs/config authority when no policy book exists, and availability checks inspect product JSON fields rather than only searching for literal `stock`.
  - Second `t01` reached `OUTCOME_OK` but scored 0 because the answer was prose and evaluator expected `<YES>`.
  - Added explicit binary/token answer-format guidance and task-instruction logging.
  - Verified `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --task=t01 --concurrency=1` returns `Score: 100%`.
  - Added full tool-output persistence in `agent/logger.ts` (`*_output.txt`) for easier log inspection.
  - Patched `agent/workspace-client.ts` to use the standard Windows Docker binary path when Docker is not on PATH.
- Tuned after latest failed `t02/t03/t04` run:
  - Failures `t02`/`t03`: answer was `YES`; evaluator required `<YES>`.
  - Failure `t04`: agent answered `<NO>` but missed matching ref `/proc/catalog/storage/tool_boxes_bags/fam_storage_tool_boxes_bags_0019_prfqxbw0/STO-23SR7SRH.json`.
  - Updated `agent/system-prompt.ts` with hard `answer_format` verification for `ANGLE_BINARY` (`<YES>`/`<NO>`) and `ANGLE_COUNT` (`<COUNT:n>`).
  - Added recursive catalogue scan requirements: enumerate/read all candidate JSONs under relevant category/kind/family subtrees before answering `<NO>`, and include exact matching SKU refs for `<YES>`.
  - Verified `npm.cmd run typecheck` and `npm.cmd run build`.
- Added concrete recursive catalog-walk code guidance:
  - Prompt now tells the model not to use `ws.search(..., "*.json")` / regex filename searches for file discovery.
  - Added exact `walk_files(root)` helper using recursive `ws.list()` and path reconstruction.
  - Added `catalogue_scan_count` requirement so `<NO>` catalogue answers fail verification if traversal found zero product JSON files or refs are empty.
  - Verified `npm.cmd run typecheck` and `npm.cmd run build`.
- Tuned structured product matching after `t04` false negative:
  - Prompt now instructs parsing product line queries into independent fields (brand, series, model, kind, requested properties) instead of requiring one full phrase match.
  - Added normalization guidance for numeric/unit properties (`2 m`, `24 V`, `4000 ml`, `10 W`) and enum-like values (`color_family`, `fuel_additive`).
  - `<NO>` catalogue existence answers now require `scratchpad["close_candidates"]` so the model documents brand/kind candidates inspected before rejecting.
  - Verified `npm.cmd run typecheck` and `npm.cmd run build`.
- Read latest run logs (`runs/2026-05-09T19-30-05-727Z`):
  - Run is incomplete: `run.jsonl` contains only `run_start`; task log has no `task_end` or `harness_result`.
  - Task was `t02`: Michelin Compact Radius 2SY-6QN Automotive Charger and Bulb, product type `battery charger`, voltage `6 V`.
  - The agent inspected two Michelin files and found the matching product in `/proc/catalog/Michelin/AUT-1FITW9M6.json` (`properties.product_type="battery charger"`, `properties.voltage_v=6`), but stopped before calling `ws.answer()`.
  - No `node`/`tsx` process was still running when checked, so this looks like an interrupted/crashed run rather than a scored false negative.
- Read focused run logs for `t02,t03,t04` (`runs/2026-05-09T19-20-35-743Z`):
  - `t02` passed: `OUTCOME_OK`, `<YES>`, score 1.
  - `t03` failed by false negative: agent answered `<NO>`, evaluator expected `<YES>`. The generated matcher only checked top-level `screw_type`/`diameter_mm`, so it likely missed values under nested `properties`.
  - `t04` failed by no answer: agent spent all 12 turns searching Metabo LiHD HWW 3L4-3ER candidates and hit max turns without calling `ws.answer()`. Logs show a relevant same-family compressor ref (`MAC-1J8HOPK3`) and a dust-extractor candidate list including `MAC-JJXY3GHP`, but the agent never consolidated fields and submitted.
- Applied catalogue tuning after that run:
  - `agent/system-prompt.ts` now requires requested properties to be read from nested `record["properties"]` first, then top-level fallback.
  - Added a `prop(record, *names)` helper pattern for matching fields such as `screw_type`, `diameter_mm`, `machine_type`, `voltage_v`, `length_m`, and `volume_ml`.
  - Added candidate scoring/intersection guidance so catalogue tasks compute required booleans across candidates and submit in the same execute_code call.
  - Added a turn-limit finalization rule: at turn 8 or later, stop exploratory searches and answer from inspected candidate data.
  - Verified `npm.cmd run typecheck` and `npm.cmd run build`.
- Read interrupted latest run logs (`runs/2026-05-09T20-04-11-354Z`):
  - Task was `t04`: Grohe Flexible Essence 2AO-EGL Valve and Connector, connector type `ball valve`, diameter `15 mm`.
  - Log stopped at turn 0 `code_call`; no turn output file and no `code_result`, confirming the process was interrupted while `execute_code` was still running.
  - Generated code recursively walked `/proc/catalog`, then attempted to `ws.read()` every JSON file and append each path to `refs` before answering. This explains the long no-output run.
  - Tuned `agent/system-prompt.ts` to require targeted candidate discovery for existence tasks: search/list by brand/model/kind first, read only the candidate union, compact refs, and avoid thousands of `ws.read()` calls unless doing an explicit count task.
  - Verified `npm.cmd run typecheck` and `npm.cmd run build`.
- Read interrupted full dev run logs (`runs/2026-05-09T20-20-52-957Z`):
  - Run reached `t12` after `t01` scored 0 for missing `<YES>`, `t02`-`t07` mostly passed, `t08` had no answer, and `t09`-`t11` passed.
  - `t12` task: count catalogue products that are `Screwdriver and Hex Key Set`, answer `<COUNT:n>`.
  - Logs show `ws.search("/proc/catalog", "Screwdriver and Hex Key Set")` returned hits in `/proc/catalog/hand_tools/screwdriver_hex_sets/...`; then the agent walked all 10,000 catalog JSON files and turn 4 started reading all files to filter `kind_id`, causing the long run and manual interruption.
  - Tuned `agent/system-prompt.ts` so count tasks map the kind phrase to a likely kind directory (example: `Screwdriver and Hex Key Set` -> `screwdriver_hex_sets`) and count JSON files under that subtree instead of reading the full catalogue.
  - Verified `npm.cmd run typecheck` and `npm.cmd run build`.
- Reviewed additional failures from the same run:
  - `t01` false negative: task asked for Stihl AP System RMA 37P-FTM Chainsaw with battery power source; agent answered `<NO>` but evaluator expected `<YES>`. Code used shallow reconstructed paths like `/proc/catalog/GRD-...` and only scanned two candidates, so it missed nested catalogue paths and did not search the distinctive model token before rejecting.
  - `t08` no answer: task asked for Einhell Precision GC Y1B-N4L Workshop Drill Grinder and Sander with `machine_type=planer thicknesser`, `voltage_v=230`, and voice-control support. Agent inspected candidates through turn 11 but never finalized; code required a nonexistent top-level `line` field and did not treat absent voice-control support as enough to answer `<NO>` after exact candidates were inspected.
  - Tuned `agent/system-prompt.ts` with explicit path handling (`ws.search` path normalization; prefer `ws.list` entry `path`), required alternate brand/model/kind search before `<NO>`, product-line matching across `brand`/`series`/`model`/`name`/`kind_id`/`properties`, and feature-field handling for voice-control-like requests.
  - Verified `npm.cmd run typecheck` and `npm.cmd run build`.
- Read slow latest run logs (`runs/2026-05-09T20-51-20-332Z`):
  - Full run took `9239.1s`. `t01` passed, `t02` false-negative `<NO>` vs expected `<YES>`, `t03`-`t06` passed, `t07`-`t12` mostly ended as no-answer.
  - Main wall-time sink was `t08`: turn 0 started at 22:57:26 and returned at 01:20:06. Generated code walked all 10,000 catalogue JSON paths and called `ws.read()` on every file for a Spax wood/drywall screw existence task, even though the task had strong discriminators (brand Spax, category fasteners/wood_drywall_screws, model `34H-Q6F`).
  - After the long `t08` call, repeated `ws.answer()` attempts failed verification due empty/incorrect scratchpad fields (`refs=[]`, `catalogue_scan_count=0`) and later workspace calls hit `ssl.SSLEOFError`/`URLError` on `ws.context()`, causing `t09`-`t12` to fail without answers.
  - Structural issue found: `agent/workspace-client.ts` has no TypeScript-side timeout around `docker exec`; Python individual workspace calls use `urllib.request.urlopen(..., timeout=30)`, but a loop of thousands of successful 30s-capable calls can run for hours.
  - Recommended improvements: add a per-`execute_code` wall-clock timeout, add a per-task timeout in `runs/run.ts`, reduce `MAX_TURNS` or enforce prompt-finalization sooner for catalogue tasks, and add a local candidate helper/template so the model does not generate full-catalogue scans for existence tasks.
- Confirmed runtime `/bin/sql` support:
  - `proto/bitgn/vm/ecom/ecom.proto` exposes `Exec`; comments state it dispatches deterministic in-runtime tools like `/bin/sql`.
  - `agent/workspace-client.ts` already exposes this through Python as `ws.exec(path, args=None, stdin="")`, so no new OpenAI tool is required and the single-tool invariant remains intact.
  - Added `agent/system-prompt.ts` guidance to prefer `ws.exec("/bin/sql", stdin="SQL...")` for catalogue-scale counts/existence queries and avoid full catalogue JSON reads.
  - Verified `npm.cmd run typecheck` and `npm.cmd run build`.
- Implemented runtime/run safeguards and catalogue helpers:
  - Reduced `MAX_TURNS` in `agent/index.ts` from 12 to 8.
  - Added `EXECUTE_CODE_TIMEOUT_MS` in `agent/workspace-client.ts` (default `180000`) to kill/resolve long `docker exec` calls.
  - Added preloaded Python helpers `norm(x)`, `norm_num(x)`, `sql_query(query)`, and `catalog_sql(query)` to the bootstrap.
  - Added `TASK_TIMEOUT_MS` in `runs/run.ts` (default `600000`, override with env or `--task-timeout-ms=...`) so a single trial returns `OUTCOME_ERR_INTERNAL` instead of blocking the worker forever.
  - Tightened `agent/system-prompt.ts`: existence tasks should use SQL or narrow again if candidate discovery exceeds ~100 files; turn 5+ must finalize instead of exploring; prompt now references the preloaded catalogue SQL helpers.
  - Verified `npm.cmd run typecheck` and `npm.cmd run build`.
- Read latest run logs (`runs/2026-05-10T08-32-47-963Z`):
  - Run improved to `877.8s` from prior `9239.1s`; timeouts/turn reduction prevented multi-hour blocking.
  - Score summary: `t01,t05,t06,t07,t09,t10,t11` passed; `t02` false-negative (`<NO>` but expected `<YES>`); `t03,t04,t08,t12` no-answer.
  - `t02`: Brennenstuhl Compact Garant 268-DCP Black extension cable. Agent scanned only 3 Brennenstuhl refs and answered `<NO>`; evaluator expected `<YES>`. Likely missed model/color mapping or a path/search variant.
  - `t03/t04/t08`: agents found plausible candidate sets but kept inspecting/printing through turn 7 and never called `ws.answer()`. Finalization rule is still not strong enough or the model is ignoring it.
  - `t12`: count task for `Workshop Saw and Cutter`; turn 0 and turn 4 hit the `EXECUTE_CODE_TIMEOUT_MS` guard. The initial code used incorrect tree traversal and fell back to full catalogue read; SQL was discovered only at turns 5-7 (`sqlite_master` showed `categories`, `product_kinds`, `families`, `products`, `product_properties`) but no final count query was issued before max turns.
  - Next tuning targets: hard-code SQL schema discovery/count examples in prompt, reduce catalogue-task max turns or add runner recovery after timeout, and force immediate answer after candidate list is non-empty at turn >=5.
- Implemented tuning after latest run:
  - Added preloaded `catalog_count_by_kind(kind_id)` helper in `agent/workspace-client.ts`, trying common `/bin/sql` count queries against `products`/`product_kinds`.
  - Added concrete SQL-first catalogue count example and common kind_id mappings in `agent/system-prompt.ts` (`Workshop Saw and Cutter` -> `saws_cutters`, etc.).
  - Strengthened prompt: after `[execute_code timeout ...]`, next call must be SQL-only or immediate `ws.answer()`; turn 5+ still must finalize.
  - Updated `agent/index.ts` to inject explicit timeout recovery and late-turn finalization hints into tool output returned to the model.
  - Updated execute tool description to mention `catalog_count_by_kind(kind_id)`.
  - Verified `npm.cmd run typecheck` and `npm.cmd run build`.
- Read latest focused run logs (`runs/2026-05-10T08-57-38-731Z`) and removed hardcoded kind maps:
  - Run appears incomplete: `run.jsonl` has harness results only for `t03` and `t04`; `t08` logs exist but no harness result.
  - `t03` log has only turn events and no code_call/code_result files, so logging was incomplete or the task failed before code persistence.
  - `t04` (Helly Hansen work trousers) kept listing/searching through turn 7 and never answered despite candidate hits for `2DC-VZY` and gray trousers.
  - `t08` (Gorilla sealant) had enough evidence by turn 3 to answer: same brand/series/model/kind candidates existed, but observed candidates did not satisfy all requested properties (Bluetooth control absent; closest white silicone candidate had `volume_ml=100`, not 310). The model still did not finalize.
  - User explicitly rejected hardcoded solutions. Removed the fixed common kind mapping list from `agent/system-prompt.ts` and added runtime-driven `catalog_find_kind_id(kind_phrase)` helper in `agent/workspace-client.ts`; prompt now says to derive kind_id from SQL/runtime data, not hardcoded maps.
  - Verified `npm.cmd run typecheck` and `npm.cmd run build`.
- Added LLM provider fallback:
  - `agent/index.ts` now tries the primary OpenAI-compatible provider first, then falls back on 429 rate limit to OpenRouter.
  - OpenRouter model order: `OPENROUTER_MODEL` default `openai/gpt-oss-120b:free`, then `OPENROUTER_FALLBACK_MODEL` default `nvidia/nemotron-3-super-120b-a12b:free`.
  - OpenRouter fallback also advances to the next OpenRouter model on API/network/empty-response failure.
  - `runs/run.ts` preflight now accepts either `LLM_API_KEY` or `OPENROUTER_API_KEY`.
  - Added `.gitignore` to keep `.env`, `dist/`, `node_modules/`, and `runs/` local.
  - Verified `npm.cmd run typecheck` and `npm.cmd run build`.
- Read latest focused run logs (`runs/2026-05-10T09-26-58-321Z`):
  - Run completed `2/4 OK` in `183.5s`; `t03` and `t12` passed, `t04` and `t08` failed with `no answer provided`.
  - `t04` (Carhartt work trousers, Red, size S) found a 16-item exact Carhartt Rugged Flex Force candidate set by turn 7, but kept printing candidates and never filtered/finalized with `ws.answer()`.
  - `t08` (Vileda cleaning machine, pressure washer, GPS) exposed a helper/schema issue: `catalog_find_kind_id()` assumed a `slug` column, but live `product_kinds` has `id`, `category_id`, and `name`.
  - `t08` later attempted `<NO>` after a zero-row SQL query, but generated `verify()` blocked it; SQL-backed negative catalogue answers need explicit prompt support (`/bin/sql` evidence and zero-row exact query can be valid).
  - No hardcoded kind-map behavior was observed in this run.
- Implemented tuning from that log review:
  - `agent/workspace-client.ts`: made `catalog_find_kind_id()` schema-safe for live `product_kinds(id, category_id, name)` and removed `slug`/`kind_id` assumptions from product-kind queries.
  - `agent/system-prompt.ts`: added live SQL schema guidance (`products.kind_id` joins `product_kinds.id`), mandatory finalization for small exact candidate sets, and SQL-backed `<NO>` evidence rules.
  - Updated verify template so a zero-row exact `/bin/sql` query can validate a negative catalogue answer when `sql_evidence` is present and refs include `/bin/sql` plus `/proc/catalog`.
  - Verified `npm.cmd run typecheck` and `npm.cmd run build`.
- Read latest focused run logs (`runs/2026-05-10T09-44-06-078Z`):
  - Run completed `1/2 OK` in `255.2s`.
  - `t04` passed with `OUTCOME_OK`, score `1`; the small-candidate finalization tuning helped.
  - `t08` failed with `no answer provided`. Task asked for Facom Professional `FAC 2XG-HDP` Screwdriver and Hex Key Set with `tool_profile=mixed`, `piece_count=10`, and Bluetooth control.
  - Logs show the agent found Facom screwdriver/hex candidates and the exact Facom Professional `FAC 2XG-HDP` line, but the visible exact candidate had `piece_count=8` and no Bluetooth field. It kept printing match lists through turn 7 instead of answering `<NO>`.
  - Next tuning target: force immediate answer after an exact brand+series+model candidate is found and requested properties are missing/mismatched; do not spend final turns printing related brand/kind matches.
- Implemented exact-line candidate hierarchy tuning:
  - `agent/system-prompt.ts` now states that exact-line candidates (brand + series + model + kind/product term) are the highest authority for catalogue existence checks.
  - Once exact-line candidates have been inspected, broader same-brand/same-kind/same-property matches may not override missing or mismatched requested properties.
  - Missing requested feature fields such as Bluetooth/GPS/voice/app control on every exact-line candidate must finalize `<NO>` with those exact-line paths as `close_candidates`.
  - Late-turn finalization now distinguishes exact-line candidates that satisfy every field (`<YES>`) from exact-line candidates that fail any requested property/feature (`<NO>`).
  - Verified `npm.cmd run typecheck` and `npm.cmd run build`.
- Read latest full run logs (`runs/2026-05-10T09-58-49-442Z`):
  - Harness scores: `t01,t05,t07,t10,t11,t12` passed; `t02,t03,t04,t06,t08,t09` failed. Runner reported `ok=9/12`, but evaluator score is `6/12`.
  - `t02`, `t03`, and `t09` share a root cause: `catalog_find_kind_id()` returns CSV text with a header, and generated code treated `id` / `id,name\n...` as the kind id. This caused false `<NO>` answers and `<COUNT:0>` instead of expected `<COUNT:2>`.
  - `t02` expected matching ref `/proc/catalog/Simpson Strong-Tie/FST-23Z7XRR4.json`; agent answered `<NO>` with refs only `["/bin/sql"]`.
  - `t03` expected `<YES>` for Pipelife pipe fitting; agent answered `<NO>` after scanning Pipelife refs because it again used bad kind-id parsing.
  - `t06` correctly attempted `<NO>` for Sonax wiper blade with missing Bluetooth, but generated `verify()` blocked it because `close_candidates` was empty despite refs containing the exact candidate SKU.
  - `t04` and `t08` remained no-answer finalization failures after reaching useful candidate sets.
  - Next tuning target: make kind-id helper output machine-readable rows or add `catalog_first_kind_id()`, require exact candidate refs in `close_candidates` for negative answers, and further discourage turn-5+ print-only searches.
- Implemented helper-output and negative-answer tuning:
  - `agent/workspace-client.ts` now provides `csv_rows(stdout)`, `first_int(stdout)`, `catalog_count_by_kind_value(kind_id)`, `catalog_first_kind_id(kind_phrase)`, and `catalog_count_by_kind_phrase(kind_phrase)`.
  - `catalog_find_kind_id(kind_phrase)` now returns parsed row dicts such as `[{"id": "chainsaws", "name": "Chainsaw"}]` instead of raw CSV text, so generated code should not confuse headers with data.
  - `agent/system-prompt.ts` count examples now use `catalog_first_kind_id()` / `catalog_count_by_kind_value()` and explicitly forbid using `"id"` or `"id,name"` as a kind id.
  - Prompt now says JSON-backed `<NO>` answers must put inspected exact-line product refs into `close_candidates`; if refs contain the exact-line SKU paths, use those same paths.
  - `agent/index.ts` tool description and timeout recovery hint now mention the safer parsed helpers.
  - Verified `npm.cmd run typecheck` and `npm.cmd run build`.
- Read latest full run logs (`runs/2026-05-10T10-13-32-672Z`):
  - Evaluator score improved to `11/12`; only `t04` failed. Runner reported `ok=11/12`, matching the single no-answer failure.
  - `t01,t02,t03,t05,t06,t07,t08,t09,t10,t11,t12` all scored `1`.
  - `t04` task: Dulux Washable Trade `1FL-9QF` Wall Paint with `color_family=Gray`, `finish=eggshell`, `volume_ml=1000`.
  - By turn 6 the agent found 18 exact Dulux Washable Trade `1FL-9QF` wall-paint records. It printed the first five exact-line candidates, then on turn 7 searched globally for Gray/eggshell/1000 candidates instead of intersecting those properties against the exact-line set and calling `ws.answer()`.
  - Turn 7 produced two global property candidate paths but no answer. Remaining tuning target: when exact-line candidates exist, property searches must be restricted/intersected to that exact-line set; global property matches are only auxiliary and must not replace exact-line finalization.
- Implemented exact-line property-intersection tuning:
  - `agent/system-prompt.ts` now explicitly requires requested property checks to be intersected within exact-line candidates after those candidates exist.
  - Global property searches are allowed only as auxiliary discovery; their paths must be intersected with exact-line paths and cannot replace exact-line finalization.
  - Turn 5+ guidance now states that print-only candidate code without `ws.answer()` is a failed task.
  - `agent/index.ts` late-turn injected hint now repeats the exact-line intersection rule and forbids printing more candidate paths without submitting.
  - Verified `npm.cmd run typecheck` and `npm.cmd run build`.
- Read latest full run logs (`runs/2026-05-10T10-28-57-494Z`):
  - Evaluator score dropped to `9/12`; failures were `t03`, `t07`, and `t12`. This run used a different randomized task set from the previous `11/12` run, so the increase is not a direct same-task regression.
  - `t03` false negative: Rothenberger Professional Rocut `2HM-5GE` Valve and Connector with `connector_type=ball valve`, `diameter=15 mm`. Agent answered `<NO>` in one turn, evaluator expected `<YES>`. Generated matcher was too brittle: it required a combined line/model phrase in one field and only checked narrow property names (`connector_type`, `type`, `kind`, `name`, `properties` values plus `diameter/diameter_mm/size_mm`).
  - `t07` no answer: Tork Universal `W 12Z-HLV` Cloth Mop and Wipe with microfiber cloth, pack count 2, GPS. Agent kept listing/searching through turn 7 and never submitted, despite having candidate data. This is still a finalization failure.
  - `t12` no answer: count task for Cloth Mop and Wipe. Agent correctly found `kind_id=cloths_mops_wipes` and `count=242`, but called `ws.answer(scratchpad, verify)` without defining `verify`, causing `NameError`.
  - `t04` passed in this run, so the exact-line property-intersection tuning likely fixed the previous Dulux failure.
  - Next tuning targets: add a preloaded/default `verify` helper or prompt rule never to call undefined `verify`; broaden structured property matching via full normalized JSON blob and common synonyms (`valve_type`, `connector_type`, etc.); strengthen finalization for simple exact-line/no-feature tasks.
- Implemented tuning after that run:
  - `agent/workspace-client.ts` now preloads a default `verify(sp)` helper, so generated code can safely call `ws.answer(scratchpad, verify)` without redefining `verify`.
  - Added preloaded matching helpers `prop(record, *names)`, `blob_text(record)`, and `has_text(record, *terms)` to reduce brittle one-off field checks.
  - `agent/system-prompt.ts` now lists those helpers as preloaded and tells the model to use property synonyms plus full normalized JSON blob matching for connector/valve type, diameter, and pack-count fields.
  - Prompt now explicitly warns count tasks to define verify or use the preloaded default verify.
  - `agent/index.ts` tool description now includes the new preloaded helpers.
  - Verified `npm.cmd run typecheck` and `npm.cmd run build`.
- Read latest full run logs (`runs/2026-05-10T11-01-14-360Z`):
  - Evaluator score was `8/12`; failures were `t01`, `t06`, `t07`, and `t08`.
  - `t01` false negative: Philips CorePro Ultra `1BQ-MPB` LED Bulb with wattage 15 W, luminous flux 1055 lm, fitting G9. Agent answered `<NO>` after only inspecting 10 top-level `/proc/catalog/*.json` files and missing nested catalogue structure/search variants. There was also a malformed code block at turn 2.
  - `t06` no answer: Simpson Strong-Tie Universal CSA `34P-WUP` with machine screw + Bluetooth. Agent had a valid SQL-backed `<NO>` with `sql_evidence.rows=0`, but default `verify()` rejected it because `search_trail` was empty. For SQL-backed answers, `sql_evidence` should satisfy the audit even when `search_trail` is empty or the helper should populate a SQL search_trail.
  - `t07` no answer: after turn 0 (`kind_id saws_cutters`), turns 1-7 were logged as `tool_calls` but no `code_call` artifacts were persisted. Likely malformed/empty tool arguments or logging blind spot.
  - `t08` no answer: all turns logged as `tool_calls`, but no code artifacts were persisted. Same likely malformed/empty tool-call issue as `t07`.
  - Next tuning targets: relax default `verify()` for SQL-backed evidence or require helpers to fill `search_trail`; improve invalid/empty tool-call logging and recovery; prevent shallow top-level-only catalogue scans for `/proc/catalog` layouts.
- Implemented tuning after that run:
  - `agent/workspace-client.ts` default `verify(sp)` now allows SQL-backed evidence (`sql_evidence.path == "/bin/sql"` with a query) to satisfy the MERCHANT/SUPPORT audit when `search_trail` is empty.
  - `agent/logger.ts` now records `tool_call_skipped` events for unexpected tool names, invalid arguments, and empty code.
  - `agent/index.ts` now sends corrective tool messages for invalid/empty `execute_code` arguments instead of silently burning turns with no `code_call` artifact.
  - `agent/system-prompt.ts` now explicitly warns that shallow `ws.list("/proc/catalog")` top-level JSON files are not the whole catalogue and cannot justify `<NO>` unless nested candidate directories are ruled out.
  - Prompt also documents that SQL-backed zero-row evidence can satisfy the audit even without `search_trail`, though SQL search_trail is preferred.
  - Verified `npm.cmd run typecheck` and `npm.cmd run build`.
- Read latest full run logs (`runs/2026-05-10T11-32-27-115Z`):
  - Evaluator score was `12/12`; all tasks passed.
  - Runtime was `337.8s`, substantially better than earlier multi-minute/multi-hour runs, though some existence tasks still used 6-8 turns.
  - Invalid tool-call recovery worked: `t07` had malformed JSON arguments at turn 6 and recovered at turn 7; `t08` attempted unexpected tool `execute_sql` and recovered after the corrective tool message.
  - SQL/count path is now strong: `t09`, `t10`, `t11`, and `t12` all answered count tasks in one turn using `catalog_first_kind_id()` / `catalog_count_by_kind_value()`.
  - Positive catalogue checks are generally accurate when candidate set is small or SQL/search gives direct refs (`t01`, `t02`, `t03`, `t04`).
  - Negative feature checks are now accurate: exact-line candidates are inspected, then missing Wi-Fi/app scheduling/etc. leads to `<NO>` with close candidates (`t05`, `t06`, `t07`, `t08`).
  - Remaining risk: the agent still sometimes uses too many exploratory turns before finalization, especially on catalogue existence tasks; malformed tool calls are recovered but cost turns.
- Implemented helper-based stability optimization:
  - `agent/workspace-client.ts` now preloads `catalog_product_rows(...)`, `catalog_score_product(record, required)`, and `catalog_find_matching_products(required, limit=100)`.
  - These helpers perform runtime SQL candidate lookup, parse product rows/properties, apply generic normalized field/property/feature scoring, and return `matches` plus `close` candidates.
  - SQL filters compare both raw lowercase and hyphen-normalized series/model/name fields to avoid missing model tokens like `1FL-9QF`.
  - `agent/system-prompt.ts` now tells the model to prefer these helpers for catalogue existence tasks and answer immediately from `matches`/`close`.
  - `agent/index.ts` tool description now lists the new helpers.
  - Verified `npm.cmd run typecheck` and `npm.cmd run build`.
- Read latest full run logs (`runs/2026-05-10T12-05-50-903Z`):
  - Evaluator score was `9/12`; failures were `t01`, `t03`, and `t08`.
  - `t01` false negative: Philips CorePro Ultra `1BQ-MPB` LED Bulb wattage 10 W. Evaluator expected ref `/proc/catalog/ELC-1F3KM1CP.json`, but agent answered `<NO>` with empty refs. Actual product fields from another task show `series=CorePro`, `model=Ultra 1BQ-MPB`, so the helper call over-constrained `series="CorePro Ultra"` and `model="1BQ-MPB"`.
  - `t03` false negative: Pipelife Master Pipe `1ON-QC6` Pipe Fitting with pipe clamp, diameter 32 mm. Agent answered `<NO>`, evaluator expected `<YES>`. Generated manual matcher normalized record model to `1on qc6` but compared it to literal `1on-qc6`, making model_ok impossible even for the correct record.
  - `t08` no answer: Einhell Compact TC `SFD-6CO` Cordless Drill Driver with Bluetooth. A manual full subtree scan timed out, helper call then returned zero close candidates, later manual search found 10 close candidates but did not submit before max turns.
  - Root theme: the new helper did not yet eliminate model-side orchestration errors. The model still has to split product lines into series/model/features, understand helper return shapes, and decide/finalize. That leaves room for over-constrained SQL queries, hyphen-normalization mistakes, and no-answer finalization.
  - Next approach should move more of the catalogue-existence workflow into one deterministic helper: broad candidate retrieval from line terms, tolerant scoring, flattened return shape, and optional scratchpad-ready answer/finalization data.
- Implemented flagged catalogue-existence stability experiment:
  - Rollback flag: `STABILITY_EXPERIMENT_CATALOG_EXISTENCE_V2_2026_05_10`.
  - `agent/workspace-client.ts` now adds `catalog_product_rows_broad()`, `catalog_score_product_v2()`, and `catalog_answer_existence(required, submit=True)` inside the flagged block.
  - The new helper takes the full product line as `required["line"]`, retrieves broad brand/kind/line candidates via `/bin/sql`, scores line tokens across `series + model + name + kind_id + properties`, handles property synonyms/units/features, builds scratchpad fields, and can call `ws.answer()` directly.
  - `agent/system-prompt.ts` and `agent/index.ts` now tell the model to prefer `catalog_answer_existence({...}, submit=True)` for binary catalogue existence tasks.
  - This is additive: older helpers remain available. To return to the previous stage, remove all blocks/references marked with `STABILITY_EXPERIMENT_CATALOG_EXISTENCE_V2_2026_05_10`.
- Read latest full run logs (`runs/2026-05-10T14-20-29-796Z`):
  - Evaluator score was `11/12`; runner reported `ok=11/12`, elapsed `523.4s`.
  - `t01`-`t08` all passed in turn 0 using the new `catalog_answer_existence()` flow. This validates the flagged catalogue-existence experiment on the latest task set.
  - Only `t09` failed: count task "Wall Paint" expected `<COUNT:n>`, but evaluator received no answer.
  - `t09` computed the right answer in turn 0: `kind_id=wall_paint`, `count=3`, `answer=<COUNT:3>`. It did not submit in turn 0 because generated code only printed `Done`.
  - On turn 1, `ws.answer()` was blocked by default `verify()` because `search_trail` was empty.
  - On turn 2, the model corrupted the valid answer into literal `<COUNT:d+>` while trying to satisfy the regex, then later turns kept submitting invalid count tokens (`<COUNT:d+>` / `<COUNT:d>`) even after adding `search_trail`.
  - Root cause: count tasks still rely on model-authored scratchpad/finalization. There is no deterministic count helper that fills `search_trail` and submits in one call, so recovery after verifier failure can mutate a correct answer into an invalid token.
  - Next tuning target: add a deterministic `catalog_answer_count(kind_phrase, submit=True)` helper and update prompt/tool description to prefer it for all `<COUNT:n>` catalogue count tasks.
- Implemented flagged catalogue-count stability experiment:
  - Rollback flag: `STABILITY_EXPERIMENT_CATALOG_COUNT_V1_2026_05_10`.
  - `agent/workspace-client.ts` now adds `catalog_answer_count(kind_phrase, submit=True)`, which resolves `kind_id`, counts via `/bin/sql`, populates `search_trail`, `reasoning_trail`, `refs`, `sql_evidence`, exact `ANGLE_COUNT` answer, and can submit directly.
  - `agent/system-prompt.ts` and `agent/index.ts` now tell the model to prefer `catalog_answer_count("Kind Phrase", submit=True)` for all catalogue count tasks requiring `<COUNT:n>`.
  - This is additive: older low-level count helpers remain available. To return to the previous stage, remove all blocks/references marked with `STABILITY_EXPERIMENT_CATALOG_COUNT_V1_2026_05_10`.
- Read latest full run logs (`runs/2026-05-10T15-47-25-862Z`):
  - Evaluator score was `12/12`; runner reported `ok=12/12`, elapsed `670.9s`.
  - All 12 tasks completed with exactly one `execute_code` call each.
  - Binary catalogue existence tasks (`t01`-`t08`) used `catalog_answer_existence(..., submit=True)` and scored correctly for both `<YES>` and `<NO>` cases.
  - Catalogue count tasks (`t09`-`t12`) used `catalog_answer_count("Kind Phrase", submit=True)` and scored correctly.
  - The previous count-task failure mode is fixed in this run: count helpers now submit exact `<COUNT:n>` tokens with non-empty `search_trail` and no regex-recovery corruption.
  - Current state: helper-driven catalogue tasks are stable on the latest dev run; remaining concern is runtime/LLM latency rather than correctness on this task mix.

---

## Decisions made

| Decision | Rationale |
|---|---|
| Single tool (`execute_code`) | Forces all reasoning into auditable Python code; no tool-choice overhead for the LLM |
| gpt-oss-120b via neuraldeep.ru | Specified in `.env`; OpenAI-compatible so runner needs no SDK |
| MAX_TURNS = 12 | Sufficient for 2–3 execute_code calls per task with headroom; do not increase without log evidence |
| Target 2–3 execute_code calls per task | Call 1 = all reads, Call 2 = all writes + ws.answer(), Call 3 = error recovery only |
| Python bootstrap preloads all imports | Agent code is shorter and faster; no import boilerplate per call |
| Docker sandbox per trial | Isolation between concurrent tasks; no network except workspace API |
| Scratchpad persisted to disk between calls | Variables survive across execute_code calls within one trial |
| verify() blocks submission | Prevents wrong outcomes from being submitted without explicit gate audit |
| Adapted from Operation Pangolin (PAC1 winner) | Proven architecture, 92/104 tasks on PAC1 |

---

## What is left to do

### BLOCKING (must fix before first real benchmark run)

- [x] **`agent/bitgn-client.ts`**: Created. Implements full harness lifecycle: `startRun → startTrial → endTrial → submitRun` using the ConnectRPC JSON protocol (plain fetch, no gRPC dep).
- [x] **`runs/run.ts` — stubs replaced**: `fetchTasks()` and `submitResult()` now call the real `BitGNClient`. Local file fallback kept for `make sandbox`.
  - ⚠️ **API shape not yet verified** — ConnectRPC method names and field names in `bitgn-client.ts` are inferred from `ecom-py/main.py` proto names. Confirm exact wire format on May 30, 2026 and fix any field name mismatches.

- [ ] **`workspace/dev-tasks.json`**: Create this file with local dev tasks for `make sandbox` testing.
  - Format: `[{ id, systemPrompt, workspaceId }]`
- [x] **TypeScript build fix**: Add `OAIMessage`, `OAITool`, and `OAIResponse` types to `agent/types.ts`; narrow/cast ConnectRPC response fields in `agent/bitgn-client.ts`.

### HIGH PRIORITY (score improvement)

- [ ] **Gate precision tuning** — run dev bench, read logs in `runs/<timestamp>/<taskId>.jsonl`, identify which gate misfires (over-denying = lost OUTCOME_OK, under-denying = security penalty).
- [ ] **Policy citation format** — evaluator likely checks `policy_citation` field; confirm required format from BitGN evaluator output.
- [ ] **Reformulation cascade** — verify SUPPORT/MERCHANT tasks correctly exhaust all 4 search patterns before returning OUTCOME_NONE_CLARIFICATION.

### MEDIUM PRIORITY

- [ ] **Benchmark baseline** — run `make run` once sandbox is live; record baseline score in this file.
- [ ] **Log review workflow** — establish habit: after each run, read 3-5 failed task logs before changing the system prompt.
- [ ] **`workspace/mock-data.json`** — create mock warehouse/customer/policy data for local sandbox testing.

---

## Known issues

### 1. BitGN API wire format not live-verified
**Status:** `agent/bitgn-client.ts` implements the ConnectRPC lifecycle and now uses service names from `proto/bitgn/harness.proto`, but the live API has not been exercised from this repo.
**Files:** `agent/bitgn-client.ts`, `runs/run.ts`.
**Fix:** Continue using `bitgn/ecom1-dev`; workspace runtime calls now target `bitgn.vm.ecom.EcomRuntime/...`, but this should be validated by the next one-task live run.

### 2. `workspace/dev-tasks.json` does not exist
**Status:** `make sandbox` will print a warning and exit with 0 tasks.
**Fix:** Create the file with at least one test task that exercises all 4 task types.

### 3. ~~`bitgn-client.ts` did not exist~~ — RESOLVED
**Status:** `agent/bitgn-client.ts` created. `runs/run.ts` imports and uses it.
**Remaining risk:** ConnectRPC field names are inferred from proto definitions in the Python SDK. The actual wire format must be verified against the live harness on May 30, 2026.

### 4. ~~Unused Anthropic dependency references~~ — RESOLVED
**Status:** `package.json`, `package-lock.json`, `Makefile`, and `README.md` no longer describe or install Anthropic/Claude dependencies for the current OpenAI-compatible runner.
**Fix:** Removed the Node dependency and Makefile install reference; refreshed docs/default model text.

### 5. `run.ts` import paths are written relative to `runs/` but TypeScript strict mode may flag them
**Status:** `import { runTask } from "./agent/index"` — paths point to `../agent/` from the file's location but the path is written as `./agent/`. This works with `npx tsx runs/run.ts` from the project root but may fail with `npx tsx` from the `runs/` directory.
**Fix:** Verify with `make run` once a real task is available.

### 6. ~~TypeScript typecheck currently fails~~ — RESOLVED
**Status:** `npm.cmd run typecheck` passes.
**Files:** `agent/index.ts`, `agent/types.ts`, `agent/bitgn-client.ts`.
**Fix:** Added OpenAI-compatible chat/tool response types in `agent/types.ts`; added safe response coercion helpers in `agent/bitgn-client.ts`.

### 7. ~~CLI script paths are inconsistent~~ — RESOLVED
**Status:** `package.json` scripts and `Makefile` now call `tsx runs/run.ts`.
**Fix:** Updated scripts/Makefile to call the real CLI entrypoint.

---

## System prompt — current state summary

**Version:** As of 2026-05-08 (no benchmark runs yet — untested against real tasks).

**What it covers:**
- Role: 4 task types (SHOPPER/CHECKOUT/MERCHANT/SUPPORT)
- Security: full adversarial resistance, fraud gate, no sub-task extraction
- Code execution: 2–3 call discipline, Call 1 = all reads, Call 2 = all writes + answer
- All 7 commerce gates in order with explicit scratchpad field requirements
- Reformulation cascade for SUPPORT/MERCHANT (4 search patterns before CLARIFICATION)
- verify() function pattern with all required field checks
- Answer format rules (bare value, no framing)

**Known gaps (not yet tuned):**
- Gate thresholds not calibrated against actual ecom-dev task distribution
- Policy citation format not confirmed against evaluator expectations
- Date arithmetic edge cases not stress-tested

---

## How to update this file

After each session, add an entry to **What was done**, update **What is left to do** (check off completed items, add new ones), and add any new entries to **Known issues** or **Decisions made**.

Do this before ending the session. The next session starts by reading this file.
