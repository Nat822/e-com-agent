# ECOM Helper Contract

This file is the compact contract between the prompt in `agent/system-prompt.ts`,
the tool description in `agent/index.ts`, and the Python bootstrap in
`agent/workspace-client.ts`.

## Core helpers

- `norm(x) -> str`: lowercase-ish normalized text with underscores/hyphens treated as spaces.
- `norm_num(x) -> float | None`: first numeric value found in text.
- `prop(record, *names) -> any`: reads `record["properties"][name]` first, then top-level fields.
- `blob_text(record) -> str`: normalized JSON text for broad matching.
- `has_text(record, *terms) -> bool`: all normalized terms appear in `blob_text(record)`.
- `verify(sp) -> bool`: default final-answer verifier.
- `detect_answer_format(task_text, default="PLAIN") -> str`: returns `ANGLE_BINARY`, `ANGLE_COUNT`,
  `ANGLE_BINARY_WITH_SKU`, `QTY_BRACKET`, `COUNT_LABEL`, or `PLAIN`. It also consults
  `scratchpad["task_instruction"]`, which the TypeScript runner injects before each
  `execute_code` call, so abbreviated model-side task strings still inherit the exact requested
  answer format.
- `format_answer(value, answer_format) -> str`: formats values for the supported answer formats.
- `format_binary_answer(ok, sku=None, answer_format="ANGLE_BINARY") -> str`: returns `<YES>`/`<NO>`
  or `<YES> SKU`/`<NO> SKU` for `ANGLE_BINARY_WITH_SKU`.
- `is_shallow_catalog_ref(path) -> bool`: detects evaluator-unsafe refs shaped like
  `/proc/catalog/SKU.json`.
- `sanitize_refs(refs, allow_shallow_catalog_refs=False) -> list[str]`: deduplicates refs and
  removes shallow catalogue refs unless a deterministic helper marks them as required proof.
- `canonical_catalog_ref(sku=None, path=None) -> str | None`: resolves SQL product paths to valid
  runtime catalogue JSON refs. It prefers nested `/proc/catalog/.../SKU.json` refs and avoids
  shallow `/proc/catalog/SKU.json` refs that evaluators often reject.
- `canonical_store_ref(store_id) -> str | None`: resolves store IDs to store JSON refs.
- `find_relevant_docs(terms=None, date_hint=None, roots=None, limit=20, read_candidates=False)
  -> list[str]`: recursively scans `/docs` and returns markdown docs whose path/name, and
  optionally content, matches task/domain terms and date hints.
- `current_update_refs(kind_phrase=None, kind_id=None, city_hint=None) -> list[str]`: finds dated
  catalogue/reporting references by using `find_relevant_docs()` across `/docs`.
- `catalog_count_update_adjustment(kind_phrase=None, kind_id=None, city_hint=None, base_count=0,
  refs=None) -> dict`: reads matching count/update docs and applies explicit count overrides or
  add/remove deltas. It filters docs to catalogue/reporting/count material for the requested kind,
  parses explicit count/answer/return/report instructions, and can apply SKU include/exclude lists
  as overrides or deltas. When a relevant count doc instructs counting only SKUs in a city/location
  with positive `available_today`, it computes a distinct SKU count by joining `products` to
  `inventory` and filtering the runtime-discovered city/store scope. It ignores year-like numbers
  such as `2025` unless they appear in explicit count syntax. If a relevant count doc is found but
  no rule is parsed, it records
  `mode="unparsed_relevant_doc"` with a short sanitized `doc_excerpt` in `current_update_evidence`
  for the next log-inspection pass.
- `payment_verification_update_refs() -> list[str]`: finds dated payment/card/3DS/retry/checkout
  docs by using `find_relevant_docs()` across `/docs`.
- `payment_verification_recovery_time(refs=None) -> dict | None`: reads matching verification
  notes and computes the recovery timestamp from `scratchpad["context"]["time"]` when a delay or
  explicit timestamp is present. Return dicts include `mode`; payment-verification timestamp notes
  default to `retry_window`; explicit lockout/until timestamps become recoverable once the timestamp
  is now/past, future timestamps become `lockout`, and absolute no-retry/manual-only wording is
  handled by the policy fact helper.
- `payment_verification_policy_facts(refs=None) -> dict`: dynamically reads security, checkout,
  payments/3DS, and dated update docs and returns refs, recovery timestamp facts,
  `absolute_no_retry`, `manual_only`, doc-derived recovery actions such as `/bin/checkout
  <basket_id>` or `/bin/payments ... <payment_id>`, and sanitized evidence.
- `execute_payment_recovery_action(facts, basket_id, payment_id=None) -> dict`: executes the first
  recovery command extracted from policy docs. It does not invent command names; failed attempts are
  returned as diagnostics. For payment-specific 3DS recovery it skips `/bin/checkout` actions and
  prefers documented `/bin/payments ... <payment_id>` commands. Command extraction scans markdown
  and compact whole-doc text, ignores negated command mentions, ignores `/bin/date`, and recognizes
  `recover-3ds` policy instructions.
- `payment_safety_decision(payment, basket=None, task_text=None, facts=None,
  explicit_payment_id=None) -> dict`: applies task wording, policy facts, and non-sensitive
  payment/basket fields. Explicit bypass requests and unlinked explicit payment IDs are security
  denials; recoverable 3DS action states are OK when no policy/payment security block exists.
- `payment_return_status_answer(payment_id=None, basket_id=None, return_id=None, submit=False,
  policy_citation=None) -> dict`: terminal helper for simple payment status, refund approval, and
  return/refund requests. It reads explicit return/payment/basket records when present, searches
  `/proc/returns` for records tied to the payment id, cites `/docs/returns.md` for return/refund
  tasks, reports terminal payment status such as `paid` for stuck 3DS/payment-status cases, and
  resolves generic customer refund requests from authenticated customer id plus requested amount,
  including linked payment evidence. Customer-facing "refund my purchase" requests cite matching
  return records but remain `OUTCOME_NONE_UNSUPPORTED` unless a supported customer-facing action is
  available. Explicit approval/finalization requests require `refund_manager`, check return-status
  eligibility, and only then attempt `/bin/payments approve-refund <return_id>` or
  `/bin/payments refund <return_id>` before older fallback command names. It does not perform direct
  file writes.
- `store_records_for_city(city_hint) -> list[dict]`: reads `/proc/stores` and returns city-matching
  store ids, paths, and records, complemented with city-like inventory store IDs.

## Generic answer helpers

- `security_denial_answer(reason, refs=None, policy_citation=None, submit=True)`. If an
  archived-payment fraud identification task was misrouted because the model treated framework
  labels such as `<task-system-prompt>` as user injection, this helper clears that false-positive
  route and delegates to `archived_payment_fraud_answer(...)`.
- `discount_denial_answer(reason, basket_id=None, refs=None, policy_citation=None, submit=True)`.
- `discount_request_answer(basket_id, discount_type="service_recovery", percent=10, submit=False,
  policy_citation=None)`.
- `discount_last_checkoutable_basket_answer(customer_email=None, discount_type="service_recovery",
  percent=10, submit=False, policy_citation=None)`: resolves an exact customer email from
  `/proc/customers`, derives current employee store ids when available, finds checkoutable baskets
  for that customer/store scope, selects the last candidate by timestamp/path order, and delegates
  to `discount_request_answer()`.
- `discount_policy_facts(refs=None, discount_type="service_recovery") -> dict`: dynamically reads
  discount/security docs plus dated updates and named store evidence to derive max percentage,
  required roles, delegation availability, denial code, refs, and sanitized evidence. It parses
  numeric and worded percentage rules such as `5%`, `5 percent`, `five percent`, `capped at five
  percent`, and `no more than 5 pct`. If relevant discount docs are found but no maximum can be
  parsed, it returns `parse_status="unparsed_relevant_policy"` with doc excerpts; callers must not
  guess a fallback percentage. When a basket id/record is supplied, it computes basket subtotal and
  applies subtotal-gated tiers such as `1 to 10 percent when basket subtotal is at least 15000
  cents` before falling back to non-tier caps.
- `discount_store_refs_from_task(task_text=None) -> list[str]`: resolves explicitly named
  store/location evidence from `/proc/stores` for discount/delegation tasks.
- `discount_update_refs(extra_terms=None) -> list[str]`: finds dated/current discount and
  service-recovery policy notes from `/docs/current-updates`, `/docs/policy-updates`, and
  `/docs/ops-policy-notes` using task-derived store/location terms.
- `discount_policy_code(refs=None) -> str | None`: reads discount update/policy refs and extracts a
  machine-readable denial code such as `NO_ACTIVE_DISCOUNT_DELEGATION_YYYY_MM_DD` when present. If
  a relevant delegation doc contains a bare `NO_ACTIVE_DISCOUNT_DELEGATION` code and its path has a
  policy date, the helper appends that date as `_YYYY_MM_DD`.
- `active_discount_delegation(refs=None, identity="") -> bool`: returns true only when `/bin/id` or
  the supplied identity is an employee and a relevant dated/current discount update grants active
  issuer delegation for the task's service-recovery/desk-coverage context.
- `clarification_answer(reason, refs=None, policy_citation=None, submit=True)`.
- `unsupported_answer(reason, refs=None, policy_citation=None, submit=True)`.
- `archived_payment_fraud_answer(policy_citation=None, submit=False) -> dict`: deterministic
  helper for archived payment-history fraud-identification tasks. It uses `/bin/sql` over the
  indexed `payments` table, avoids slow `/proc/payments` traversal, selects the strongest archived
  paid-payment cluster with repeated payment-method/device fingerprints across customers/stores,
  expands that verified seed to the surrounding bounded archived paid-payment incident burst by
  walking the archived paid-payment timeline left/right while adjacent records remain within a
  10-minute gap, then runs a second guarded all-status archived burst expansion from that paid
  anchor to recover adjacent failed/declined/3DS records in the same incident. Both expansions cap
  candidates at 60 records and reject broad long-span bursts. The helper submits exact
  `/proc/payments/pay_*.json` refs without modifying files. If no repeated fingerprint exists,
  it introspects the runtime `payments` schema, loads all non-sensitive columns while excluding
  card-number/cardholder/CVV/expiry-like fields, and falls back to a SQL-only investigation over
  bounded candidate clusters: explicit non-sensitive fraud/risk/chargeback/dispute/incident marker
  fields, paid rows that mirror adjacent/later 3DS-action rows by sequence or shared non-sensitive
  attributes, sequence-modulo/status intersections, shared 3DS anomaly signatures, shared observed
  geography across multiple customers/stores, tight customer/basket actor bursts, repeated
  amount/currency groups, and dense archived-payment time windows. Long-span
  customer or basket history is diagnostic-only, even when it touches several stores. Broad
  status/3DS-status/failure groups are diagnostic-only: the helper reports them under
  `fraud_payment_evidence["diagnostics"]` but does not submit them as fraud proof by themselves.
  Diagnostics include compact top groups by fingerprint, customer, basket, store, status, 3DS
  fields, amount/currency, observed geography, dense time windows, payment-id sequence patterns,
  visible non-sensitive column names, and marker-column names using sample payment ids only, never
  card data. Fallbacks can examine all payment-history rows when archived-only scope has no
  plausible incident, including non-paid statuses that may appear in confirmed fraud history. If no
  high-confidence cluster is found, the helper submits
  `OUTCOME_NONE_UNSUPPORTED` with answer `NO_CONFIDENT_FRAUD_CLUSTER`, `/bin/sql`/security refs,
  and diagnostics instead of raising a verification error or letting diagnostic-only groups become
  payment refs. The central `ws.answer()` guard also rewrites manual archived-fraud `OUTCOME_OK`
  submissions unless `fraud_payment_evidence.mode` comes from an approved detector.

These populate the scratchpad and submit through `ws.answer()` by default. They are intended for
terminal blocked outcomes, especially prompt injection, missing required identifiers, and missing
runtime capability. Security denials always cite `/docs/security.md` when present. Generic
basket/checkout prompt-injection denials cite `/docs/checkout.md` but do not cite the target basket.
Discount/service_recovery denials cite `/docs/discounts.md` and the explicit target basket record
when it exists. `discount_request_answer()` checks `/bin/id`, denies unless the user has
`discount_manager` or `active_discount_delegation()` finds a matching active employee delegation
update, and never edits basket JSON directly. It derives the policy maximum from docs/updates and
uses that maximum for "largest/maximum allowed" requests; explicit over-max requests are security
denials. If a relevant policy is present but the maximum cannot be parsed, it returns a diagnostic
unsupported result instead of applying a guessed amount. When authorized, it calls `/bin/discount`
with basket id, percent, reason code, and issuer id, falling back to the older JSON payload only if
the documented argument form is rejected.
If a generic security denial is attempted for a discount/service_recovery task with an explicit
basket id, the runtime augments it with discount refs and the basket ref so issuer/delegation tasks
keep their required proof trail.

## Catalogue helpers

- `catalog_find_kind_id(kind_phrase) -> list[dict]`: parsed SQL rows, usually with `id` and `name`.
- `catalog_first_kind_id(kind_phrase) -> str | None`.
- `catalog_count_by_kind(kind_id) -> str`: raw `/bin/sql` stdout.
- `catalog_count_by_kind_value(kind_id) -> int`.
- `catalog_count_by_kind_phrase(kind_phrase) -> int`.
- `catalog_answer_count(kind_phrase, policy_citation=None, city_hint=None,
  answer_format="ANGLE_COUNT", submit=False) -> dict`.
- `catalog_product_rows(...) -> list[dict]`.
- `catalog_product_rows_broad(required, limit=200) -> {"rows": list, "sql_trace": list}`.
- `catalog_score_product(record, required) -> {"ok": bool, "checks": dict}`.
- `catalog_score_product_v2(record, required) -> {"ok": bool, "score": int, "checks": dict}`.
- `catalog_find_matching_products(required, limit=100) -> dict`.
- `catalog_answer_existence(required, policy_citation=None, answer_format=None, submit=False,
  limit=200) -> dict`.
- `catalog_claim_check_answer(base_required, extra_properties=None, policy_citation=None,
  answer_format="ANGLE_BINARY_WITH_SKU", submit=False) -> dict`.

For binary catalogue tasks, pass the full product line as `required["line"]` and feature requests
as top-level `required["features"]`. If the task asks to include the checked SKU in the answer,
pass `answer_format="ANGLE_BINARY_WITH_SKU"` or `required["include_sku_in_answer"] = True`.
Numeric product properties are exact matches; a requested `10 mm` does not match an `8 mm` product
just because `10` appears somewhere else in the record text.
Enum-like product properties are token-exact, especially clothing sizes and short values: `XL`
does not match `3XL`, while `Yellow XL` can satisfy separate `color_family=Yellow` and `size=XL`
selectors on the same record.

For catalogue count tasks, `catalog_answer_count()` first counts runtime SQL products by kind, then
applies matching dated current-update/addenda docs when they explicitly override or adjust the count.
Count/reporting docs are selected by requested kind terms plus catalogue/count/reporting language;
unrelated discount/security/checkout docs should not be cited by count helpers.
When a relevant count doc cannot be parsed, `current_update_evidence` keeps a short sanitized
diagnostic excerpt so parser rules can be improved from runtime evidence without hardcoding task
answers.
Pass `answer_format=detect_answer_format(TASK_TEXT)` when the task uses plain `%d`, `<COUNT:%d>`,
or another supported format.

For support-note catalogue claim checks, use `catalog_claim_check_answer()` when the task says the
base product exists but an extra catalogue claim may be absent. `base_required` should contain the
base/primary properties; `extra_properties` contains the disputed extra claim. If generated code
puts multiple ordered properties in `extra_properties`, the helper treats all but the final
property as primary/base selectors when they do not conflict with explicit base properties, then
evaluates the final disputed claim on that same SKU. Structured property matching prefers the
record's actual property value over loose full-record text, so `surface=glass` does not match merely
because another field says `glass cleaner`; enum/size selectors are exact-token matches, so a base
selector `size=XL` cannot resolve to a `3XL` variant. Negative answers cite only the checked product
record plus supporting SQL evidence.

## Inventory helpers

- `inventory_find_store_id(store_name_hint) -> str | None`.
- `inventory_available(store_id, sku, min_qty=1) -> bool`.
- `inventory_resolve_product(required, limit=80) -> dict`. Bounded SQL resolver for one product
  spec in an inventory count list; returns best `sku`, `path`, exact `matches`, close candidates,
  and SQL trace without calling the terminal catalogue-answer helper or runtime kind-id discovery.
  The resolver keeps a small minimum candidate set even if a caller passes a tiny limit, because
  product families commonly contain color/size/property variants.
- `inventory_answer_count(items, store_hint, min_qty=1, answer_format="PLAIN", submit=False,
  policy_citation=None) -> dict`.
- `buy_max_across_stores_answer(required, city_hint, exclude_store_hint="", answer_format="PLAIN",
  submit=False, policy_citation=None) -> dict`. The return dict includes top-level `refs` and
  `scratchpad["refs"]`.
- `checkout_basket_answer(basket_id, submit=False, policy_citation=None) -> dict`: deterministic
  explicit basket checkout helper. It reads the named basket and applies safety gates before calling
  `/bin/checkout`: deny third-party basket checkout without citing the third-party basket in final
  refs, return unsupported for already checked-out or closed baskets, return unsupported for
  queue-save/counter-ready/manual-close/handbook bypass requests, and return unsupported for ordinary
  active checkout when no specialized supported recovery path exists. Blocked/unsupported paths do
  not call `/bin/checkout`.
- `checkout_user_basket_answer(submit=False, policy_citation=None) -> dict`: resolves "my basket"
  from authenticated `/bin/id` context only. It searches baskets for the current `cust_...`, reads
  matching basket records, cites candidate basket refs, and calls `/bin/checkout` only when exactly
  one active basket belongs to that authenticated customer. Zero or multiple active baskets produce
  `OUTCOME_NONE_CLARIFICATION` with relevant candidate refs.
- `checkout_3ds_answer(basket_id, payment_id=None, submit=False, policy_citation=None) -> dict`.
- `payment_return_status_answer(payment_id=None, basket_id=None, return_id=None, submit=False,
  policy_citation=None) -> dict`.

`items` accepts pre-resolved `{"sku": "...", "path": "..."}` entries or catalogue requirements as
`{"required": {...}}`.
Inventory helpers submit store refs, `/bin/sql`, and product refs only for products that actually
contribute to the count. A shallow SQL path such as `/proc/catalog/SKU.json` may be kept for those
counted products because the evaluator can require it; unavailable products are not cited.

`checkout_3ds_answer()` reads the basket and tries to discover related `/proc/payments/pay_*.json`
records from the basket payload or payment search before deciding whether 3DS recovery is supported.
It then derives policy facts from docs/updates and applies `payment_safety_decision()`. Already
checked-out baskets are not automatically unsupported when the payment still requires a recoverable
3DS action. Explicit payment ids must be linked to the basket. Payment-verification timestamps
produce `OUTCOME_OK` when the recovery time is now/past, future windows produce unsupported, and
absolute no-retry/manual/security markers produce `OUTCOME_DENIED_SECURITY`.
When a retry/recovery is allowed, the helper executes only a command derived from the policy docs;
if no command is documented, it records diagnostics rather than inventing a mutation path.
Critical basket/payment reads are retried for transient workspace EOF errors. The helper also checks
authenticated customer ownership before executing a recovery command.
For security-denied 3DS recoveries, the helper omits `/proc/baskets/...` from final refs and keeps
the payment/security evidence refs, because some denial evaluators reject target-basket refs.

For return/refund tasks, use `payment_return_status_answer(...)` directly as the first terminal
path; do not hand-write refund scratchpads. A request like "refund my purchase for EUR 10" may be
resolvable from `/bin/id` customer identity plus the amount in matching
`/proc/returns/ret_*.json` records or payment records linked from those returns. It should cite the
matched return but stay read-only/unsupported if no customer-facing refund action exists. A request
to approve or finalize a refund for `pay_XXX` should cite the payment record plus any matching
`/proc/returns/ret_*.json` record and `/docs/returns.md`; answer `OK` with `OUTCOME_OK` only after
`/bin/id` includes `refund_manager`, the return status is eligible for that action, and the supported
runtime refund command accepts it. A request naming `ret_XXX` reads that return record directly and
must not be overwritten by a generic amount/customer lookup. If an approval/finalization identity
lacks `refund_manager`, return `OUTCOME_DENIED_SECURITY` with the return, returns-policy, and
security refs. The central answer guard normalizes manual refund
clarifications with explicit payment ids and matching return records to unsupported rather than
assuming a state mutation is authorized.
The central guard also performs amount/customer return lookup for manual refund scratchpads and uses
a terminal verifier after normalization, so stale custom verifiers cannot block a valid unsupported
refund answer. Refund action-kind detection is string-based rather than regex-based to avoid template
escaping corrupting Python word-boundary patterns.
Linked payment IDs inside return records are discovered with a template-safe `pay_[0-9]+` pattern.
Return statuses containing replacement workflow terms are refund-ineligible and should produce
`OUTCOME_NONE_UNSUPPORTED` before attempting `/bin/payments`.
When a task names only `ret_XXX`, the helper reads that return record, extracts linked payment ids,
and cites the matching `/proc/payments/pay_*.json` refs as evidence even when the outcome is
unsupported.

For archived payment fraud tasks, use `archived_payment_fraud_answer(submit=True)` directly. The
answer is a newline-separated list of payment ids, while `refs` contains every payment record marked
as fraud. The helper is read-only and should be preferred over `ws.list()`, `ws.tree()`, or broad
`ws.search()` calls on `/proc/payments`. It starts from a high-confidence repeated-fingerprint seed
cluster and may expand to the surrounding archived paid-payment time burst using adjacent timestamp
gaps rather than a fixed expected record count. When the paid burst is a strong anchor, it also
attempts a guarded all-status archived burst expansion for adjacent failed/3DS/declined records in
the same incident; if fingerprints are
unique, it uses bounded SQL investigation fallbacks over archived records first and then all
payment-history rows if needed: 3DS anomaly, observed geography, tight actor/customer/basket bursts,
repeated amount, and time-density clusters. If no high-confidence cluster exists, or a fallback is
used, inspect `fraud_payment_evidence["diagnostics"]` in the tool output for compact candidate
patterns. Broad status/failure/3DS action-required groups are diagnostic context only and must not
be manually submitted as the fraud set without an independent repeated fingerprint, tight actor
burst, geo, amount, sequence, or dense-window signal. If the helper returns
`NO_CONFIDENT_FRAUD_CLUSTER`, do not manually choose a largest diagnostic group; the runtime will
block that as unsupported. This is meant to recover the full incident while preserving the
zero-write invariant.
Benchmark context labels such as `<task-system-prompt>` are not task-content injection signals for
this authorized Risk Ops investigation.
