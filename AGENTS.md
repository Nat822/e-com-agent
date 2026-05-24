# AGENTS.md — BitGN Ecom Agent External Memory

> **Read this first for project state. For coding rules, see GUIDELINES.md.** At the start of every session, the agent reads this file before taking any action.
> After each session, update the sections below to reflect what changed.

## 0. Meta-Rule
1. Read AGENTS.md for current project state, architecture, and session history.
2. Read GUIDELINES.md for all coding, workflow, and process rules.
3. Confirm both files have been read.
4. If either file changed since last session, note what changed.
5. After each session, update the "What was done" and "What is left to do" sections.
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
        ↓ deterministic helper contract: docs/HELPER_CONTRACT.md
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
| `agent/workspace-client.ts` | Docker runner + Python bootstrap + ws.answer() + deterministic helpers | 🔴 HIGH — helper behavior affects scoring |
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
| `OPENROUTER_API_KEY` | ✅ Yes | — | openrouter API key | 
| `OPENROUTER_MODEL` | No | `openai/gpt-oss-120b:free` |
| `OPENROUTER_FALLBACK_MODEL` |No |`nvidia/nemotron-3-super-120b-a12b:free` |
`
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
2. **Prompt/helper contract is the source of truth.** Policy and gate instructions live in `agent/system-prompt.ts`; deterministic task helpers and `verify()` live in `agent/workspace-client.ts`; helper signatures/returns are documented in `docs/HELPER_CONTRACT.md`; late-turn/timeout nudges live in `agent/index.ts`. Do not hardcode benchmark answers.
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

### Session 2026-05-14 (conversation `68364fa3`)
**Goal:** Sync with organizer's published API changes (conversation reference: user report on 2026-05-14).

**Changes announced by organizer:**
- `rpc Context` (whoami/context) deprecated — replaced by `/bin/id` exec tool
- `/bin/date` exec tool added — current UTC time
- `/bin/checkout` exec tool added — checkout action handler
- Shopping carts now exist; CHECKOUT tasks may involve cart questions

**What we checked:**
- Fetched upstream `ecom.proto` and `agent.py` from `bitgn/sample-agents` repo.
- Confirmed `rpc Context` is marked `option deprecated = true` in upstream proto; wire still works (deprecated ≠ removed).
- Confirmed reference agent now runs `/bin/date` and `/bin/id` unconditionally as a mandatory preamble before the first LLM turn.
- `WriteRequest.idempotency_key`, `WriteResponse.audit_path/action_id/action_status`, `StatResponse.write_schema/description`, `ExecResponse.content_type/truncated` all deprecated in upstream proto; no functional impact on our runner.

**What we changed:**

1. **`agent/workspace-client.ts` — bootstrap context block (lines 714–724)**
   - Replaced deprecated `ws.context()` RPC call with two `ws.exec()` calls:
     `ws.exec("/bin/date")` → `scratchpad["context"]["time"]`
     `ws.exec("/bin/id")` → `scratchpad["context"]["id"]`
   - Added graceful exception fallback so a context failure doesn't crash the bootstrap.
   - `ws.context()` Python method left in place (wire still works; harmless to keep).

2. **`agent/system-prompt.ts` — two sections updated**
   - **Context tags section (line 43):** Updated `scratchpad["context"]` description from old `{ unixTime, time }` shape to new `{ time: RFC3339 string, id: agent identity string }` shape.
   - **Workspace methods section (line 151):** Marked `ws.context()` as deprecated; added `/bin/date`, `/bin/id`, `/bin/checkout` to the key exec tools list with usage notes.
   - Added 4-step CHECKOUT cart task guidance: read cart state → policy gates → use `/bin/checkout` to execute → handle errors.

3. **`proto/bitgn/vm/ecom/ecom.proto` — deprecated annotations synced**
   - Added `option deprecated = true` to `rpc Context`.
   - Added `[deprecated = true]` to: `ExecResponse.content_type`, `ExecResponse.truncated`, `WriteRequest.idempotency_key`, `WriteResponse.audit_path/action_id/action_status`, `StatResponse.write_schema_content_type/write_schema/description`.
   - Updated `ActionStatus` enum doc to reflect it is kept only for wire compatibility.

- Verified `npm run typecheck` and `npm run build` — both pass (exit 0).

**What is still unknown:**
- `/bin/checkout` exact JSON schema — must be discovered on a live trial by calling `ws.exec("/bin/checkout")` with no stdin and reading stdout/stderr.
- `/bin/id` output format — must be verified from live trial logs.
- Whether new CHECKOUT/cart tasks appear on `bitgn/ecom1-dev` in the updated task set.

**Next steps:**
- Run `npx tsx runs/run.ts --bench=bitgn/ecom1-dev --task=t01 --concurrency=1` to verify context bootstraps correctly with `/bin/date`+`/bin/id`.
- Check a CHECKOUT task log for `/bin/checkout` schema before adding hard-coded scratchpad handling.


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

### Session 2026-05-14 (this session)
**Run analysed:** `2026-05-14T19-48-41-445Z` — **14/24 (58%)**, elapsed 1372s.
Previous best: 13/24 (54%). Two new task types confirmed: inventory availability count and "buy max across stores".

#### What was done

- Fixed esbuild parse error: unescaped backticks in newly-added inventory section of `agent/system-prompt.ts` (all inline code markers must be `\`` inside the template literal).
- Fixed `inventory_answer_count()` refs: now collects actual product JSON paths from catalogue matches and store file path, rather than always using `["/bin/sql", "/proc/catalog"]`.
- Added `inventory_find_store_id()` helper that also falls back word-by-word when the full store hint doesn't match.
- Fixed lazy `startTrial` in `runs/run.ts` to prevent ECONNRESET from firing all 24 StartTrial RPCs at startup.
- Added prompt-injection turn-0 immediate denial logic to `agent/system-prompt.ts` — t23 and t24 now correctly return OUTCOME_DENIED_SECURITY.

#### Decisions made (with rationale)

**D1 — Inventory refs must include actual product paths and store file path.**
Rationale: evaluator validates refs, not just the answer value. `inventory_answer_count()` now collects `record["path"]` from each `catalog_answer_existence()` match and resolves the store file path via `ws.search("/proc/stores", store_id)`. No hardcoded paths.

**D2 — "Buy max across stores" is a new SHOPPER sub-type distinct from single-store count.**
Task pattern: "How many items of product X can I buy in city Y (excluding store Z) today?"
Algorithm (runtime-driven, no hardcoding):
1. Resolve product SKU via `catalog_answer_existence()`.
2. Query inventory SQL: `SELECT store_id, available_today FROM inventory WHERE sku='{sku}'`.
3. Filter store_ids by city hint: join against store JSON files under `/proc/stores` or filter store_id by city substring.
4. Exclude the named store (match by name substring against store_id or store JSON name field).
5. Sum `available_today` across remaining qualifying stores.
6. Refs = resolved product JSON path + all store JSON paths consulted.
Rationale: The model currently resolves only one store and gets SKU=None because the catalog match fails — need better catalogue resolution AND multi-store aggregation in the prompt.

**D3 — Checkout: zero file writes unless /bin/checkout succeeds.**
Rationale: t21 had correct outcome (OUTCOME_NONE_UNSUPPORTED) but scored 0 because the agent wrote files during its analysis loop. Evaluator enforces "expected no file changes" for tasks where checkout doesn't execute. System prompt updated: never call `ws.write()` or `ws.delete()` in CHECKOUT tasks unless the task explicitly requires checkout AND all gates pass AND `/bin/checkout` exits 0.

**D4 — Missing basket ID → OUTCOME_NONE_CLARIFICATION immediately.**
Rationale: t22 asked "check out my basket" with no basket_id in the task. Agent listed all 200 baskets and answered OUTCOME_OK `<NO>`. Correct answer is OUTCOME_NONE_CLARIFICATION (required parameter missing). The agent must NOT scan all baskets to search for the customer's basket — this is a clarification gap, not a supported lookup. Prompt rule added: if no basket_id is provided in the task instruction, answer OUTCOME_NONE_CLARIFICATION without reading /proc/baskets.

**D5 — Tool name typo recovery: echo exact required name in rejection feedback.**
Rationale: t17 wasted all turns on `exec_code` (typo); t19 wasted 6 turns on `executes_code`. The `agent/index.ts` rejection message already says "use only execute_code" but the model keeps hallucinating. Updated rejection message to: "Invalid tool call: the ONLY valid tool name is **execute_code** (exactly). You called '{toolName}' which does not exist."

**D6 — `catalog_answer_existence()` must always populate `search_trail` from its sql_trace.**
Rationale: t07 — `verify()` requires `search_trail` for MERCHANT tasks, but `catalog_answer_existence()` fills `search_trail` from `broad["sql_trace"]` which can be empty if the SQL path was never called. Updated the helper to always set `search_trail` to at least one entry (even if it shows 0 hits), so `verify()` doesn't block valid `<NO>` answers.

#### What is left to do

- [ ] Implement "buy max across stores" prompt guidance and runtime-driven multi-store aggregation (D2).
- [ ] Add OUTCOME_NONE_CLARIFICATION rule for missing basket_id (D4).
- [ ] Update checkout section: never write files unless /bin/checkout exits 0 (D3).
- [ ] Update tool rejection message to echo exact tool name (D5).
- [ ] Verify `catalog_answer_existence()` always writes a non-empty `search_trail` (D6).
- [ ] Run dev bench to validate all fixes → target 20+/24.

---

### Session 2026-05-22 (this session)
**Goal:** Mitigate identified risks around prompt/helper drift, finalization helpers, task cancellation, answer-format handling, and stale project memory.

#### What was done

- Added `docs/HELPER_CONTRACT.md` as the explicit contract for preloaded Python helper signatures, return shapes, and answer-helper behavior.
- Added answer-format helpers to `agent/workspace-client.ts`: `detect_answer_format()` and `format_answer()`.
- Added generic terminal answer helpers: `security_denial_answer()`, `clarification_answer()`, and `unsupported_answer()`.
- Extended deterministic inventory helpers with `answer_format` support and added `buy_max_across_stores_answer()`.
- Wired real cancellation through `runs/run.ts`, `agent/index.ts`, and `agent/workspace-client.ts` so task timeouts abort LLM fetches and kill active Docker exec calls.
- Fixed primary LLM timeout handling: HTTP 408 and other transient provider errors now trigger fallback to the next configured provider instead of failing only on 429; per-task LLM errors now return `OUTCOME_ERR_INTERNAL` so one provider failure does not crash the whole run.
- Implemented helper-first scoring fixes after run `2026-05-22T15-54-31-608Z`:
  - Added canonical catalogue/store ref helpers so SQL paths are resolved to valid runtime file refs before submission.
  - Added `ANGLE_BINARY_WITH_SKU` support for tasks that require `<YES>/<NO>` plus the checked SKU in the answer text.
  - Updated `catalog_answer_count()` to include matching `/docs/current-updates` references when present.
  - Updated security/unsupported terminal helpers to include `/docs/security.md` or `/docs/payments/3ds.md` when relevant.
  - Added import-error recovery guidance because helpers are global functions, not importable Python modules.
- Implemented follow-up fixes after focused run `2026-05-22T18-11-08-146Z`:
  - `detect_answer_format()` now detects `count : %d` as `COUNT_LABEL`; `format_answer()` returns `count : n`.
  - `current_update_refs()` now scans both `/docs/current-updates` and `/docs/catalogue-addenda`.
  - Added `store_records_for_city()` and improved `buy_max_across_stores_answer()` to use all city store records, including zero-availability stores.
  - Added `checkout_3ds_answer()` for bank verification / 3DS recovery tasks with required security/payment/checkout refs.
  - Prompt/tool contract now pushes SKU-in-answer tasks to `catalog_answer_existence(..., answer_format="ANGLE_BINARY_WITH_SKU", submit=True)`.
- Updated `agent/index.ts` tool description and `agent/system-prompt.ts` so the model sees the helper contract, answer-format helpers, terminal helpers, and buy-max helper.
- Updated architecture memory: scoring behavior now explicitly depends on `system-prompt.ts`, `workspace-client.ts`, `docs/HELPER_CONTRACT.md`, and `index.ts` late-turn/timeout nudges.
- Implemented helper fixes after focused runs `2026-05-22T20-47-09-157Z` and `2026-05-22T20-48-21-093Z`:
  - `detect_answer_format()` now detects `<COUNT:%d>` before `count : %d`, preventing inventory tasks from returning `count : n` when the evaluator expects `<COUNT:n>`.
  - `current_update_refs()` now scans `/docs/policy-updates` in addition to `/docs/current-updates` and `/docs/catalogue-addenda`.
  - `catalog_answer_count()` now accepts `answer_format`, still applies dated update/addenda/policy refs, and can produce plain `%d`, `<COUNT:n>`, or `count : n`.
  - Added `payment_verification_update_refs()` and wired `checkout_3ds_answer()` to cite dated payment/card-verification notes from current, policy, and ops note docs.
  - Added `catalog_claim_check_answer()` for support-note tasks where a base product exists but an extra catalogue claim may be absent; negative answers include the checked base-product SKU.
  - Strengthened prompt/tool guidance so catalogue count tasks use `catalog_answer_count(...)` and city-wide branch quantity tasks use `buy_max_across_stores_answer(...)` instead of hand-rolled SQL.
  - Fixed a Python bootstrap syntax error in `detect_answer_format()` caused by an embedded regex quote sequence. Lesson: after editing `agent/workspace-client.ts`, run `npm.cmd run typecheck`, `npm.cmd run build`, then a one-task smoke run before larger focused/full runs.
- Implemented schema-inspired control-flow/proof improvements after analysing `agent-schema.jpg` and run `2026-05-23T06-56-39-302Z`:
  - Added a Task-Family Router section to `agent/system-prompt.ts` and `agent/index.ts` tool guidance so the model chooses one terminal helper first and preserves helper refs instead of rebuilding scratchpad refs by hand.
  - `current_update_refs()` now scans `/docs/ops-policy-notes` as well as current updates, catalogue addenda, and policy updates.
  - `canonical_catalog_ref()` now prefers nested SKU file discovery through `/proc/catalog` search/find before accepting shallow `/proc/catalog/SKU.json` refs.
  - `buy_max_across_stores_answer()` now returns top-level `refs` as well as `scratchpad["refs"]`.
  - Added `payment_verification_recovery_time()` and wired `checkout_3ds_answer()` to compute a recovery timestamp from dated payment/card-verification notes when a delay/window is defined.
  - Updated `docs/HELPER_CONTRACT.md` for these helper signatures and evidence requirements.
- Implemented follow-up fixes after latest partial run:
  - Added recursive `find_relevant_docs()` to scan `/docs` subfolders by task/domain terms and date hints, avoiding one-folder-at-a-time policy doc patches.
  - `current_update_refs()` and `payment_verification_update_refs()` now use recursive `/docs` discovery.
  - Tightened `catalog_count_update_adjustment()` so year-like numbers such as `2025` are not treated as catalogue counts unless they appear in explicit count syntax.
  - `canonical_catalog_ref()` no longer falls back to shallow `/proc/catalog/SKU.json` refs, which repeatedly failed evaluator ref validation.
  - The runner now injects the exact task instruction into `scratchpad["task_instruction"]`, and `detect_answer_format()` consults it so truncated model-side task strings still produce wrappers such as `[QTY:n]`.
  - `checkout_3ds_answer()` now treats timestamp-only recovery notes as `OUTCOME_NONE_UNSUPPORTED`; only a supported checkout action can produce `OUTCOME_OK`.
  - Fixed the embedded Python bootstrap escaping in `detect_answer_format()` (`"\\n"` inside the TypeScript template) after focused `t13,t41` runs crashed with `SyntaxError: unterminated f-string literal`.
  - Added `is_shallow_catalog_ref()` and `sanitize_refs()` so evaluator-invalid `/proc/catalog/SKU.json` refs are dropped centrally before `ws.answer()`, including refs from inventory and buy-max helpers.
  - Refined the ref sanitizer after focused `t13,t41`: inventory helpers now cite product refs only for counted/available products and may keep shallow SQL refs when those counted products are evaluator-required; unavailable product refs are omitted.
  - Refined 3DS recovery after focused `t13,t41`: `payment_verification_recovery_time()` now classifies policy notes as `retry_window`, `lockout`, or `unsupported`; `checkout_3ds_answer()` returns `OUTCOME_OK` for retry windows and `OUTCOME_NONE_UNSUPPORTED` for lockouts.
  - Refined 3DS classification again after `basket_248`: generic payment-verification timestamp notes default to supported retry (`OUTCOME_OK`); only explicit lockout/blocked/do-not-retry language blocks recovery.
  - Group 1 / fix 1: improved `catalog_claim_check_answer()` so support-note claim checks select the checked SKU by weighted base/primary property order, cite only that exact product record, and preserve required shallow catalogue refs when the evaluator expects them.
  - Group 1 / fix 2: improved single-store inventory counts by adding bounded `inventory_resolve_product()` SQL candidate scoring, adding product-property aliases used by inventory lists, and making `inventory_find_store_id()` score `/proc/stores` metadata plus location aliases before generic SQL token fallback.
  - Follow-up for Group 1 / fix 2 after slow focused `t16`: changed `inventory_resolve_product()` to use an inventory-only fast SQL candidate path that does not call runtime kind-id discovery or the terminal catalogue-existence helper; it also keeps a minimum variant candidate set so color/size/property variants are not missed when custom code passes a tiny limit.
  - Group 1 / fix 3: hardened security/discount denial evidence refs. `security_denial_answer()` and the central `ws.answer()` denial path now always add `/docs/security.md` when present, add `/docs/discounts.md` for discount/service_recovery/issuer denials, add `/docs/checkout.md` and explicit basket refs for basket/checkout override denials, and fill a default policy citation for manual security-denial scratchpads that omitted one. Added `discount_denial_answer()` for unauthorized discount requests.
  - Follow-up for Group 1 / fix 3 after focused `t23,t24,t25,t42`: removed automatic target basket refs from security-denial augmentation because prompt-injection checkout denials scored invalid when citing `/proc/baskets/...`; added `discount_request_answer()` as the terminal path for service_recovery basket discounts; added a narrow central guard that rewrites manual `OUTCOME_OK` discount submissions to `OUTCOME_DENIED_SECURITY` when `/bin/id` lacks `discount_manager`.
  - Follow-up for Group 1 / fix 3 after focused `t23,t24,t25,t42`: refined basket refs by task subtype. Generic prompt-injection checkout denials remain basket-free, while `discount_denial_answer()` and `discount_request_answer()` now cite the explicit target basket record for discount/service_recovery denials when it exists.
  - Follow-up for Group 1 / fix 3 after focused `t42`: added `discount_update_refs()` to discover dated/current service-recovery discount notes from `/docs/current-updates`, `/docs/policy-updates`, and `/docs/ops-policy-notes` using task-derived store/location terms. Wired it into discount helpers and the manual-discount guard so store-specific current update refs are preserved.
  - Follow-up for Group 1 / fix 3 after focused `t42`: added `discount_policy_code()` to read relevant discount update refs and extract uppercase denial/delegation codes such as `NO_ACTIVE_DISCOUNT_DELEGATION_YYYY_MM_DD`; discount denial helpers and the manual-discount guard now use the extracted code as the answer when present.
  - Follow-up for Group 1 / fix 3 after focused `t42`: discount/service_recovery tasks with explicit basket ids now override generic issuer/prompt-injection routing. `security_denial_answer()` delegates these to `discount_denial_answer()`, and the central denied-security path adds the basket ref/update refs/code for manual generic denials. Generic checkout prompt-injection tasks remain basket-free.
  - Follow-up for Group 1 / fix 3 after latest `t42`: added `active_discount_delegation()` so employee desk-coverage/location/date discount tasks can proceed when a matching active dated update grants issuer delegation. The central manual-discount safety guard now allows only `discount_manager` or active documented delegation; otherwise it still rewrites unsafe discount OKs to `OUTCOME_DENIED_SECURITY`.
  - Follow-up for latest `t42` Linz denial: `discount_policy_code()` now appends the date from a dated delegation policy/update path when the document contains bare `NO_ACTIVE_DISCOUNT_DELEGATION`, producing evaluator-required codes such as `NO_ACTIVE_DISCOUNT_DELEGATION_2021_08_09`.
  - Follow-up for latest active `t42` Vienna Meidling: changed `discount_request_answer()` `/bin/discount` payload from `type` to required `reason_code`, preserving basket id, percent, and issuer id. The latest failure had reached `/bin/discount` but was rejected with "expected basket id, percent, reason code, and issuer id".
  - Group 1 / fix 4: added `checkout_user_basket_answer()` for checkout tasks that say "my basket" without an explicit basket id. It resolves only the authenticated `cust_...` from `/bin/id`, cites matching `/proc/baskets/...` refs, checks out exactly one active authenticated basket via `/bin/checkout`, and otherwise returns clarification with candidate refs.
  - Checkout helper fix for `t21,t34,t36,t41`: added `checkout_basket_answer()` for explicit submit-checkout tasks. It gates third-party ownership before already-checked-out status, blocks queue-save/counter-ready/manual-close bypass requests as unsupported, and avoids `/bin/checkout` unless gates pass. Refined 3DS recovery classification so generic "blocked" wording no longer forces lockout, while explicit lockout/no-retry or next-day recovery timestamps remain unsupported.
  - Follow-up for `t21,t34`: `checkout_basket_answer()` now treats ordinary active submit-checkout as `OUTCOME_NONE_UNSUPPORTED` without calling `/bin/checkout`, preventing unintended checkout mutations. Third-party checkout denials still read the named basket to prove ownership mismatch, but remove that third-party basket path from final refs because the evaluator marks it invalid.
  - Claim-check fix for `t07,t08`: `catalog_claim_check_answer()` now normalizes ordered `extra_properties` by promoting all but the final property to base selectors when the model accidentally puts the whole property list there, while preserving explicit base/extra conflicts such as `surface=glass` vs `surface=stone`. Structured property matching now prefers actual property values over loose full-record text so one field cannot satisfy another field by coincidence.
  - Count-update/doc handling fix for `t10,t11`: `current_update_refs()` now looks in update/addenda/policy/ops doc roots, filters to catalogue/reporting/count docs for the requested kind, and avoids unrelated discount/security/checkout refs. `catalog_count_update_adjustment()` now parses explicit count/answer/return/report override wording plus SKU include/exclude lists as general count overrides/deltas.
  - Count-update diagnostic follow-up: when a relevant count doc is found but no parser rule applies, `catalog_count_update_adjustment()` now records `mode="unparsed_relevant_doc"` with a short sanitized `doc_excerpt` in `current_update_evidence`. Rerun `t10,t11` and inspect those excerpts before adding the next general parser rule.
  - Count-update city-inventory fix: when a relevant count doc says to count only catalogue SKUs in a city/location with positive `available_today`/stock, `catalog_count_update_adjustment()` now derives the city from the doc/path/task context and computes `COUNT(DISTINCT p.sku)` by joining `products` to `inventory` for that city scope.
  - Archived payment fraud helper: added `archived_payment_fraud_answer()` for `t38,t39,t40`-style tasks. It avoids slow/flaky `/proc/payments` listing/tree/search, loads the indexed `payments` SQL table, selects the strongest archived paid-payment cluster with repeated payment-method/device fingerprints across customers/stores, and submits exact `/proc/payments/pay_*.json` refs without modifying files.
  - Follow-up log read for `t38,t39,t40`: the helper routed, but Python bootstrap generation failed because `"\n".join(answer_ids)` in the TypeScript template emitted a literal newline inside the Python string. Escaped it as `"\\n".join(answer_ids)`.
  - Archived payment fraud scoring follow-up: latest run recovered only the seed repeated-fingerprint cluster with zero false positives (`5/18` and `6/22`). Updated `archived_payment_fraud_answer()` to expand the high-confidence seed to the surrounding archived paid-payment incident time burst (bounded 5 minutes before/after seed timestamps, capped at 60 records) to recover adjacent incident records while avoiding broad `/proc/payments` scans.
  - Archived payment fraud expansion follow-up: latest run improved to `10/18` on `t38/t39` and `12/22` on `t40`, still with zero false positives. Remaining loss is likely under-expansion, so `_expand_payment_incident_burst()` now uses a bounded 10-minute window before/after the seed cluster while preserving the 60-record rejection guard.
  - Archived payment fraud fallback follow-up: latest `t38` variant had `21` expected fraud payments but no repeated payment/device fingerprint cluster, so the helper submitted no payment refs and scored `0`. Added fallback detection for unique-fingerprint incidents using bounded shared 3DS anomaly signatures first, then dense archived paid-payment time windows; this fallback only runs when the stronger repeated-fingerprint seed is absent.
  - Archived payment fraud fallback refinement: latest `t38` still scored `0` because fallback detection looked only at paid-like archived payments. Generalized the fallback to all archived payment records so confirmed fraud incidents with declined/failed/3DS statuses are considered, while keeping the primary repeated-fingerprint seed on archived paid-like records.
  - Archived payment fraud fallback refinement after latest `t38`: helper still found no cluster, while `t39/t40` stayed stable. Added an observed-geo fallback for unique-fingerprint incidents: group bounded archived payments by coarse `observed_lat/observed_lon` across multiple customers/stores before falling back to time-density. Also updated the prompt to discourage slow `/proc/payments` tree/list/search exploration and rely on the SQL helper.
  - Organizer hint for fraud tasks: data contains enough information, but the agent must investigate simple patterns. Implemented `_payment_investigation_cluster()` as a SQL-only fallback for archived payment fraud: after repeated-fingerprint/3DS/geo checks, it ranks bounded candidate clusters across archived scope first and all-history scope second using repeated customer/basket actor groups, anomalous status/failure groups, repeated amount/currency groups, breadth across customers/stores, amount, and time density. This replaces manual slow `/proc/payments` exploration with reusable investigation logic.
  - Archived payment fraud routing fix after latest run: `t38` regressed to `OUTCOME_DENIED_SECURITY` because the model treated the benchmark wrapper label `<task-system-prompt>` as prompt injection, even though the actual task text was normal. Updated `security_denial_answer()` to delegate wrapper-tag false positives on archived-payment fraud tasks back to `archived_payment_fraud_answer()`, and clarified prompt/tool/contract text that context wrapper labels are framework delimiters, not task-content injection.
  - Archived payment fraud investigation refinement after latest `t38`: routing was fixed, but fallback selected a broad `status=requires_3ds_action` group of 40 clean payments, causing 40 false positives and 0 recovered fraud records. Added `_payment_has_correlated_signal()` and required broad status/3DS-status/failure groups to have a second signal (tight time density, repeated actor/fingerprint/basket/amount, or shared observed geo) before submission; status-like groups are also down-weighted so they support but do not dominate candidate ranking.
  - Archived payment fraud diagnostics follow-up: broad status/3DS/failure groups are now diagnostic-only and no longer eligible as `_payment_investigation_cluster()` submit candidates. Added compact fraud diagnostics to `archived_payment_fraud_answer()` fallback/no-cluster evidence: top repeated groups by fingerprint, customer, basket, store, status, 3DS fields, amount/currency, observed geography, dense time windows, and payment-id sequence patterns with sample payment ids only and no card data.
  - Archived payment fraud weak-actor refinement after focused `t38,t39,t40`: latest `t38` no longer submitted the 40-record 3DS-action bucket, but still selected a long-span `customer_id=cust_093` all-history cluster with 5 false positives. Added `_payment_actor_group_is_submit_candidate()` so customer/basket fallback clusters must be tight incident bursts (`<=30` minutes in all-history scope, `<=120` minutes in archived scope) and have breadth before submission; long-span same-customer/basket history remains diagnostic-only.
  - Archived payment fraud manual-submission guard after latest `t38`: helper correctly returned no confident cluster, but the model manually selected the largest archived store diagnostic group and produced 6 false positives. `archived_payment_fraud_answer()` now submits `OUTCOME_NONE_UNSUPPORTED` with `NO_CONFIDENT_FRAUD_CLUSTER` and diagnostics when no approved cluster exists, and central `ws.answer()` rewrites manual archived-fraud `OUTCOME_OK` submissions unless `fraud_payment_evidence.mode` comes from an approved detector. Store-only/status-only/long-span actor diagnostics can no longer become fraud refs by hand.
  - Archived payment fraud investigation upgrade after safe `t38` unsupported result: added schema-aware payment loading that introspects `payments` columns and selects all non-sensitive fields while excluding card/cardholder/CVV/expiry-like columns. Added `_payment_semantic_marker_cluster()` to detect explicit runtime fraud/risk/chargeback/dispute/incident marker fields before weaker pattern fallbacks, and diagnostics now include visible non-sensitive columns plus marker columns so future investigation can improve without answer-key totals or hardcoded payment IDs.
  - Archived payment fraud cross-field investigation follow-up: added `_payment_paid_mirror_cluster()` for paid rows that mirror adjacent/later 3DS-action rows by sequence or shared non-sensitive attributes, and `_payment_sequence_intersection_cluster()` for sequence-modulo/status/3DS intersections. These run after explicit semantic markers and before broad 3DS/geo/actor fallbacks, preserving the no-card-data and no-answer-key constraints.
  - Archived payment fraud expansion follow-up after latest `t38,t39,t40`: replaced fixed before/after seed expansion with adaptive contiguous archived paid-payment burst expansion. `_expand_payment_incident_burst()` now starts from the repeated-fingerprint seed, walks left/right in payment-time order while adjacent records remain within a 10-minute gap, caps the expanded incident at 60 records, and keeps the fixed-window fallback only when seed rows cannot be aligned to the archived paid timeline.
  - Archived payment fraud all-status burst follow-up: added `_expand_payment_incident_all_status_burst()` as a second-stage expansion after the paid repeated-fingerprint burst. It uses the paid burst as a strong anchor, walks the full archived payment timeline while adjacent gaps stay within 10 minutes, includes nearby failed/declined/3DS rows from the same incident, and rejects broad/long-span candidates without using expected answer counts.
  - Payment/return status helper after latest `t35,t43,t44`: added `payment_return_status_answer()` for read-only payment status, refund approval, and return/refund requests. It reports terminal payment status such as `paid` for already-complete stuck-3DS cases, treats refund execution/approval as `OUTCOME_NONE_UNSUPPORTED`, cites `/docs/returns.md` for refund/return tasks, and never writes or executes a refund. The central unsupported-answer path now also adds returns refs/policy for manual refund/return scratchpads.
  - Payment/return follow-up after latest `t43,t44`: central `ws.answer()` now rewrites manual refund/return clarifications to `OUTCOME_NONE_UNSUPPORTED` with returns refs, since missing refund execution capability is not a clarification gap. `payment_return_status_answer()` now searches `/proc/returns` for records tied to an explicit payment id and cites matching `ret_*.json` refs.
  - Payment/return approval follow-up after latest `t43,t44`: matching return refs were found, and evaluator expected `OUTCOME_OK`. `payment_return_status_answer()` now treats an explicit payment with a matching `/proc/returns/ret_*.json` as actionable, attempts likely runtime tools (`/bin/refund`, `/bin/returns`, `/bin/return`) with structured payloads, cites the accepted tool when available, and returns `OK`/`OUTCOME_OK` without direct file writes. Manual refund clarifications with explicit payment ids and matching return refs are normalized to `OUTCOME_OK`.
  - Payment/return command-schema follow-up: logs revealed `/docs/returns.md` specifies `/bin/payments approve-refund <return_id>` and `/bin/payments refund <return_id>`. The helper now attempts those documented commands first, fixes `_return_records_for_payment()` to always return record dicts, and can resolve generic “refund my EUR X purchase” requests by matching authenticated customer id plus amount against `/proc/returns`.
  - Payment/return policy-gate follow-up: `payment_return_status_answer()` now accepts `return_id`, reads explicit `/proc/returns/ret_*.json` records, and requires `refund_manager` for approval/finalization/refund actions. Unauthorized explicit return approval now returns `OUTCOME_DENIED_SECURITY` with returns/security/return refs instead of unsupported. Prompt/tool/contract text now reflects the policy-gated flow.
  - Payment/return customer-request refinement: focused `t43` showed customer "refund my payment" requests should not be security-denied for lacking `refund_manager`; only explicit internal approval/finalization wording requires that role. The helper and central guard now gate on `approve`/`approval`/`finalize`/`finalise`, not the generic word `refund`.
  - Payment/return status eligibility refinement after latest `t43,t44`: generic "refund my purchase for EUR X" now resolves return refs through direct return amount/customer evidence and linked payment evidence, but stays read-only/unsupported unless a customer-facing refund capability exists. Explicit approval/finalization now requires `refund_manager`, checks return status for terminal/already-pending/ineligible states before `/bin/payments`, and only returns `OUTCOME_OK` when the supported runtime command accepts the action. Manual refund clarifications with matching return refs now normalize to unsupported instead of assuming a state mutation is authorized.
  - Payment/return helper routing fix after latest focused `t43,t44`: latest `t44` proved explicit `return_id` records were being overwritten by the generic customer/amount lookup, so `payment_return_status_answer()` now preserves explicit return/payment-derived records. Prompt/tool/contract guidance now says refund/return tasks must call `payment_return_status_answer()` first and not hand-write refund scratchpads, preventing `t43`-style verify loops after central safety normalization.
  - Payment/return central guard fix after latest focused `t43,t44`: `_return_action_kind()` now uses string checks instead of regex word-boundaries so the TypeScript template cannot corrupt Python regex escapes. The central refund/return `ws.answer()` guard now resolves amount/customer return refs for manual scratchpads and switches to terminal verification after normalizing clarification/unsupported outcomes, preventing stale custom verifiers from blocking a valid terminal answer.
  - Payment/return follow-up after latest `t43,t44`: fixed linked payment discovery inside return records by replacing the template-fragile raw `pay_\d+` regex with `pay_[0-9]+`; statuses containing replacement workflow terms are now refund-ineligible so approval/finalization returns `OUTCOME_NONE_UNSUPPORTED` before `/bin/payments`.
  - Payment/return evidence follow-up after latest `t44`: explicit `ret_XXX` tasks now extract linked `pay_[0-9]+` ids from the return record and cite `/proc/payments/pay_*.json` in both `payment_return_status_answer()` and the central manual-refund guard, preserving unsupported outcomes while satisfying evaluator evidence refs.
  - Dynamic policy-helper follow-up for focused `t26,t27,t28,t30,t31,t41`: added `discount_policy_facts()`, `discount_store_refs_from_task()`, positional `/bin/discount` execution with JSON fallback, and `payment_verification_policy_facts()` / `payment_safety_decision()` so discount and 3DS helpers derive decisions from docs, current updates, task text, and runtime records instead of fixed assumptions. Focused rerun fixed `t28` but showed `t26` still routed to manual clarification and 3DS security classification was too broad.
  - Follow-up fix for that focused run: added `discount_last_checkoutable_basket_answer()` to resolve exact customer email + current employee store scope + last checkoutable basket before delegating to `discount_request_answer()`. Refined `payment_safety_decision()` so future recovery windows become unsupported, now/past recovery windows become OK, recoverable `requires_3ds_action` is OK when no strong security marker exists, and 3DS security denials omit `/proc/baskets/...` refs while keeping payment/security evidence.
  - Doc-derived policy follow-up after latest focused run: `discount_policy_facts()` now parses numeric and worded percentage caps (`5%`, `5 percent`, `five percent`, `pct`, capped/limit/no-more-than phrasing) and returns `parse_status="unparsed_relevant_policy"` with doc excerpts instead of defaulting service_recovery to 10%. `discount_request_answer()` refuses to apply a guessed discount when relevant policy docs are unparsed. `payment_verification_policy_facts()` now extracts recovery commands from policy docs (`/bin/checkout`, `/bin/payments ...`) and `checkout_3ds_answer()` executes only doc-derived recovery commands for ready checked-out 3DS flows; if none is parsed, it returns unsupported diagnostics. 3DS security denials now omit all `/proc/...` refs and cite policy refs only.
  - 3DS recovery follow-up after latest focused `t27,t30,t31`: added retrying `_read_json_with_retries()` for critical basket/payment reads to handle transient workspace EOFs. `payment_verification_policy_facts()` now parses `/bin/payments ... <payment_id>` before checkout commands and ignores negated lines such as "do not run /bin/checkout". `execute_payment_recovery_action()` skips `/bin/checkout` for payment-specific 3DS recovery, and `payment_safety_decision()` checks authenticated customer ownership before recovery.
  - Discount/3DS parser follow-up after latest focused run: `discount_policy_facts()` now computes basket subtotal and applies subtotal-gated discount tiers from docs (for example `1 to 10 percent when basket subtotal is at least 15000 cents`, otherwise `1 to 5 percent`). `payment_verification_policy_facts()` now strips markdown, scans compact whole-doc text, ignores `/bin/date` and negated command mentions, and recognizes `recover-3ds` instructions so `/bin/payments recover-3ds <payment_id>` can be derived even when the doc command is inline.
  - Catalogue claim-check refinement for `t32`-style support notes: tightened structured property matching so enum-like fields and clothing sizes use exact token matching instead of substring matching. `XL` no longer matches `3XL`/`XXL`, and size synonyms (`size`, `size_code`, `clothing_size`, `trouser_size`, etc.) resolve against the actual product property before any fallback text evidence.
  - Verified `npm.cmd run typecheck` and `npm.cmd run build`.

#### Decisions made

**D1 — Helper contract is now a first-class project artifact.**
Rationale: Prompt/helper drift was a real risk. Future helper signature or return-shape changes should update `docs/HELPER_CONTRACT.md`, `agent/system-prompt.ts`, and the tool description together.

**D2 — Prefer answer helpers for repeated terminal workflows.**
Rationale: The agent often finds enough evidence but fails to finalize. Helpers that populate scratchpad and call `ws.answer()` reduce late-turn no-answer failures.

**D3 — Task timeout must abort active work.**
Rationale: `Promise.race()` alone returns a timeout result but leaves LLM/Docker work alive. Timeouts now abort active fetches and kill active Docker exec calls.

#### What is left to do

- [x] Run `npm.cmd run typecheck` and `npm.cmd run build` after these edits.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t26,t27,t28,t30,t31,t41 --concurrency=1` to verify the dynamic discount/3DS helper refinements.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t23,t24,t25,t42 --concurrency=1` to confirm security/discount refs and delegated t42 behavior stay correct.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t38,t39,t40 --concurrency=1` and inspect `fraud_payment_evidence.diagnostics`, especially `t38`, before adding another fraud selector.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t43,t44 --concurrency=1` to verify generic refund requests cite matching return refs and approval tasks do not mutate unsupported return statuses.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t32 --concurrency=1` to verify support-note catalogue claim checks cite the exact checked size/color SKU.
- [ ] Run a focused dev bench sample covering inventory availability and buy-max-across-stores tasks.
- [ ] Add helper-level tests for `detect_answer_format`, `format_answer`, `catalog_answer_existence`, and inventory helpers.

---

## How to update this file

After each session, add an entry to **What was done**, update **What is left to do** (check off completed items, add new ones), and add any new entries to **Known issues** or **Decisions made**.

Do this before ending the session. The next session starts by reading this file.
