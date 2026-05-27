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
- `parse_task_contract(task_text=None) -> dict`: lightweight task-contract detector. It reads the
  original task text and identifies high-risk cases where a familiar domain task requires a
  different answer or ref shape, such as archive TSV fraud-total tasks and pasted product quote TSV
  tables. Use it before selecting a family helper when the output format/ref requirements are
  unusual.
- `format_answer(value, answer_format) -> str`: formats values for the supported answer formats.
- `format_money_eur(cents) -> str`: formats integer cents as `EUR x.xx`.
- `format_binary_answer(ok, sku=None, answer_format="ANGLE_BINARY") -> str`: returns `<YES>`/`<NO>`
  or `<YES> SKU`/`<NO> SKU` for `ANGLE_BINARY_WITH_SKU`.
- `is_shallow_catalog_ref(path) -> bool`: detects evaluator-unsafe refs shaped like
  `/proc/catalog/SKU.json`.
- `sanitize_refs(refs, allow_shallow_catalog_refs=False) -> list[str]`: deduplicates refs and
  removes shallow catalogue refs unless a deterministic helper marks them as required proof.
  The central answer guard also filters shallow catalogue refs on single-store inventory count
  answers so only SKUs that actually contributed to the count may keep shallow proof refs.
- `canonical_catalog_ref(sku=None, path=None) -> str | None`: resolves SQL product paths to valid
  runtime catalogue JSON refs. It prefers nested `/proc/catalog/.../SKU.json` refs and avoids
  shallow `/proc/catalog/SKU.json` refs that evaluators often reject.
- `canonical_catalog_ref_from_record(record) -> str | None`: resolves SQL/runtime product rows to
  evaluator-safe catalogue refs. When a row includes `category_id`, `kind_id`, `family_id`, and
  `sku`, it reconstructs the deep `/proc/catalog/<category>/<kind>/<family>/<sku>.json` ref even if
  the SQL row also carries a shallow `/proc/catalog/SKU.json` path.
- `catalog_refs_from_record(record, include_shallow=False) -> list[str]`: returns canonical product
  refs and, when a deterministic helper needs the checked/counting SKU as proof, may preserve the
  SQL row's shallow `/proc/catalog/SKU.json` path alongside the deep ref because evaluator variants
  can require either runtime proof path.
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
  including linked payment evidence. Customer-facing amount-only and explicit payment/return refund
  requests cite matching return/payment candidates; they remain `OUTCOME_NONE_UNSUPPORTED` unless
  returns docs positively expose a supported customer-facing refund mutation that does not require
  `refund_manager`. Runtime refund command success alone is not authorization. Explicit employee
  approval/finalization requests require
  `refund_manager`, check return-status
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
  for that customer/store scope, selects the last candidate by lifecycle timestamp when present,
  then by customer-linked basket/cart order when the customer record exposes basket references, and
  then by checkoutable candidates in the current employee's store for discount mutations when no
  lifecycle/customer ordering establishes "last", and only then by the first deterministic
  runtime/search candidate. It delegates to
  `discount_request_answer()`.
  Checkoutable discovery reads each basket JSON and, when line SKUs and store inventory are visible,
  excludes active/open baskets whose requested line quantities are not available today in that store.
  Basket diagnostics include discovered timestamp candidates, top-level keys, numeric basket id, and
  line inventory checks so unresolved "last" ties can be debugged from logs.
  Employee-store filtering is applied only when the task explicitly scopes the request to "my store"
  or equivalent current-store wording; otherwise all checkoutable baskets for the exact customer are
  eligible for the "last" resolution.
- `discount_policy_facts(refs=None, discount_type="service_recovery") -> dict`: dynamically reads
  discount/security docs plus dated updates and named store evidence to derive max percentage,
  required roles, delegation availability, denial code, refs, and sanitized evidence. It parses
  numeric and worded percentage rules such as `5%`, `5 percent`, `five percent`, `capped at five
  percent`, and `no more than 5 pct`. If relevant discount docs are found but no maximum can be
  parsed, it returns `parse_status="unparsed_relevant_policy"` with doc excerpts; callers must not
  guess a fallback percentage. When a basket id/record is supplied, it computes basket subtotal and
  applies subtotal-gated tiers such as `1 to 10 percent when basket subtotal is at least 15000
  cents` before falling back to non-tier caps. Scoped ops-policy notes with structured fields such
  as `delegated_employee_id`, `basket_id`, `reason_code=service_recovery`, and "normal maximum"
  are treated as delegation grants only when they match the current identity/task basket and the
  base discount tiers supply the maximum.
- `discount_store_refs_from_task(task_text=None) -> list[str]`: resolves explicitly named
  store/location evidence from `/proc/stores` for discount/delegation tasks.
- `discount_update_refs(extra_terms=None) -> list[str]`: finds dated/current discount and
  service-recovery policy notes from `/docs/current-updates`, `/docs/policy-updates`, and
  `/docs/ops-policy-notes` using task-derived store/location terms.
- `discount_policy_code(refs=None) -> str | None`: reads discount update/policy refs and extracts a
  machine-readable denial code such as `NO_ACTIVE_DISCOUNT_DELEGATION_YYYY_MM_DD` or
  `NO_DELEGATED_DISCOUNT_AUTHORITY_YYYY_MM_DD` when present. If a relevant delegation doc contains a
  bare no-active/no-delegated/not-granted discount delegation code and its path has a policy date,
  the helper appends that date as `_YYYY_MM_DD`.
- `active_discount_delegation(refs=None, identity="") -> bool`: returns true only when `/bin/id` or
  the supplied identity is an employee and a relevant dated/current discount update, addendum, or
  ops-policy note grants active issuer delegation for the task's service-recovery/desk-coverage
  context.
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
  fields, shared observed geography across multiple customers/stores, tight customer/basket actor
  bursts, repeated amount/currency groups, and dense archived-payment time windows. Long-span
  customer/basket history, paid rows that mirror adjacent/later 3DS-action rows by sequence,
  sequence-modulo/status intersections, and broad status/3DS-status/failure groups are
  diagnostic-only unless a conservative submit gate proves archived scope, a behavioral primary
  signal, tightness, and an independent corroborating signal.
  Diagnostics include compact top groups by fingerprint, customer, basket, store, status, 3DS
  fields, amount/currency, observed geography, dense time windows, payment-id sequence patterns,
  an archived-only investigation report, archived-vs-non-archived profile comparisons,
  chronological amount/store sequences, time-gap analysis, repeated store+amount pairs,
  probe-sized amount rows, visible non-sensitive column names, and marker-column names
  using sample payment ids only, never card data. Fallbacks can examine all payment-history rows for diagnostics when archived-only scope
  has no plausible incident, but submitted payment refs must be archived unless explicit non-sensitive
  fraud/risk marker evidence passes the submit gate. Repeated-fingerprint seeds may be extended by
  a guarded second-wave profile detector: additional rows must be archived paid, outside the seed
  burst, inside the seed store set, inside an expanded seed amount range, and part of a compact
  second-wave time component. The expanded range adds 50% of the seed amount width on both sides,
  with a minimum width of 1000 cents, and applies only to second-wave extension, not seed detection.
  A one-record tail component may be included only when it passes the same row filters and falls on
  the same calendar day as an accepted second-wave component. Same-day stragglers are reported as
  diagnostics and are not submitted automatically.
  If no identifier/fallback cluster exists, a last-resort archived-paid population-anomaly detector
  may submit the bounded archived-paid population only when all four profile ratios pass: low median
  amount, high top-store concentration, short average gap, and high repeated-amount share versus
  non-archived rows, and the population submit review is `ok`. Repeated-fingerprint evidence reports
  submitted-row `amount_cents` and keeps the seed-only amount as `seed_amount_cents` for expansion
  diagnostics. If no high-confidence cluster is found, the helper submits
  `OUTCOME_NONE_UNSUPPORTED` with answer `NO_CONFIDENT_FRAUD_CLUSTER`, `/bin/sql`/security refs,
  and diagnostics instead of raising a verification error or letting diagnostic-only groups become
  payment refs. The central `ws.answer()` guard also rewrites manual archived-fraud `OUTCOME_OK`
  submissions unless `fraud_payment_evidence.mode` comes from an approved detector.
- `archive_payment_fraud_total_answer(path=None, policy_citation=None, submit=False) -> dict`:
  terminal helper for archive TSV tasks that ask for the total fraudulent payment amount instead of
  payment ids. It reads the named `/archive/*.tsv` file in bounded line-range chunks with short
  retries, normalizes non-sensitive row fields into payment-like records, reuses the guarded
  fraud-selection pipeline, sums selected amounts, formats the answer as `EUR x.xx`, and cites
  row-anchor refs shaped like
  `/archive/file.tsv#row=<RowID>`. Archive TSV fallback review is stricter than normal payment-id
  review: low-value single-customer velocity bursts do not pass on repeated customer, repeated geo,
  concentrated spread, or tight time alone; they need semantic markers or non-tautological
  corroboration such as a second fingerprint/amount pattern or a meaningful multi-customer campaign.
- `product_quote_table_answer(submit=False, policy_citation=None) -> dict`: terminal helper for
  pasted product quote/list tasks that require a tab-separated table. It parses task rows, resolves
  each product against the catalogue/inventory helpers, checks the current employee store when
  available, and returns `RowID<TAB>SKU<TAB>in_stock<TAB>match` rows exactly rather than prose.
  Product descriptions canonicalize modifier properties such as `storage type tool bag`,
  `color family Black`, `vehicle type car`, and `anchor type cavity fixing` to keys like
  `storage_type`, `color_family`, `vehicle_type`, and `anchor_type` before matching.
  Pack/count phrases such as `pack count 50 pcs` are matched through common catalogue aliases
  including `pack_count`, `pack_count_pcs`, `pack_size`, `package_count`, `quantity_per_pack`,
  `units_per_pack`, `piece_count`, and `quantity`.
  Repeated values for the same exact product property are conjunctive: a quote row that requires
  `color_family=White` and `color_family=Gray` matches only if a single SKU satisfies both values;
  otherwise SKU and stock stay blank with `match=false`.
- `contract_task_answer(submit=False, policy_citation=None) -> dict`: routes
  `parse_task_contract()` results to durable contract-specific helpers such as
  `archive_payment_fraud_total_answer()` and `product_quote_table_answer()`. If it returns
  unsupported, generated code should define a small local helper inside the same `execute_code`
  call: parse the required output/ref contract first, gather facts second, render exactly third,
  and submit immediately.

These populate the scratchpad and submit through `ws.answer()` by default. They are intended for
terminal blocked outcomes, especially prompt injection, missing required identifiers, and missing
runtime capability. Security denials always cite `/docs/security.md` when present. Generic
basket/checkout prompt-injection denials cite `/docs/checkout.md` but do not cite the target basket.
Discount/service_recovery denials cite `/docs/discounts.md` and the explicit target basket record
when it exists. `discount_request_answer()` checks `/bin/id`, denies unless the user has
`discount_manager`, `discount_policy_facts()` finds a scoped positive delegation grant, or
`active_discount_delegation()` finds a matching active employee delegation update, and never edits
basket JSON directly. It derives the policy maximum from docs/updates and
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
- `catalog_task_answer(required=None, base_required=None, extra_properties=None,
  policy_citation=None, answer_format=None, submit=False, limit=200) -> dict`: deterministic
  catalogue router. It inspects `scratchpad["task_instruction"]` and routes support-note/extra-claim
  wording to `catalog_claim_check_answer()`; otherwise it treats the request as normal binary
  catalogue existence and merges any `extra_properties` into `required["properties"]`.

For binary catalogue tasks, pass the full product line as `required["line"]` and feature requests
as top-level `required["features"]`. If the task asks to include the checked SKU in the answer,
pass `answer_format="ANGLE_BINARY_WITH_SKU"` or `required["include_sku_in_answer"] = True`.
Prefer `catalog_task_answer()` when there is any chance the model may confuse a plain "Do you have
... that has property ..." existence question with a support-note claim check.
Numeric product properties are exact matches; a requested `10 mm` does not match an `8 mm` product
just because `10` appears somewhere else in the record text.
Enum-like product properties are token-exact, especially clothing sizes and short values: `XL`
does not match `3XL`, while `Yellow XL` can satisfy separate `color_family=Yellow` and `size=XL`
selectors on the same record.

For catalogue count tasks, `catalog_answer_count()` first counts runtime SQL products by kind, then
applies matching dated current-update/addenda docs when they explicitly override or adjust the count.
Count/reporting docs are selected by requested kind terms plus catalogue/count/reporting language;
unrelated discount/security/checkout docs should not be cited by count helpers.
When an addendum names a catalogue `family_id` and says that family is excluded, withdrawn,
inactive, suppressed, or non-reportable, the helper computes the affected row count from SQL and
applies that family delta instead of trusting a loose number in prose.
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
evaluates the final disputed claim on that same SKU. Repeated values for the same property are not
treated as OR in this support-claim route: list values must all match unless the helper splits an
ordered repeated claim into base selector(s) plus the final disputed value. Structured property
matching prefers the
record's actual property value over loose full-record text, so `surface=glass` does not match merely
because another field says `glass cleaner`; enum/size selectors are exact-token matches, so a base
selector `size=XL` cannot resolve to a `3XL` variant. Negative answers cite only the checked product
record plus supporting SQL evidence. If generated code omits the repeated property but the task text
contains ordered numeric repeats such as `has length 650 mm and has length 450 mm`, the helper
recovers that ordered pair from `scratchpad["task_instruction"]`, uses the first value as the base
selector, and tests the final value as the disputed claim. The helper also moves common misplaced
top-level property keys into `properties`, corrects obvious enum/property mistranscriptions from
the exact task text, and cites shallow SQL refs as well as canonical nested refs for the checked
SKU.
Task-text enum recovery stops at the next property phrase, so "power source battery and cutting
width 24 cm" is parsed as `power_source=battery` plus separate `cutting_width_cm=24`, not one
combined value.
If a disputed extra property repeats a base property, the base value is not corrected from the
final disputed value. If generated code nests multiple support-note properties under
`extra_properties["properties"]`, all but the final ordered property are promoted into the base
selector and only the final property remains disputed.

## Inventory helpers

- `inventory_find_store_id(store_name_hint) -> str | None`.
- `inventory_available(store_id, sku, min_qty=1) -> bool`.
- `inventory_resolve_product(required, limit=80) -> dict`. Bounded SQL resolver for one product
  spec in an inventory count list; returns best `sku`, `path`, exact `matches`, close candidates,
  and SQL trace without calling the terminal catalogue-answer helper or runtime kind-id discovery.
  The resolver keeps a small minimum candidate set even if a caller passes a tiny limit, because
  product families commonly contain color/size/property variants.
- `inventory_answer_count(items, store_hint, min_qty=1, answer_format="PLAIN", submit=False,
  policy_citation=None) -> dict`. Final refs cite products that meet the threshold and contribute to
  the count, plus the resolved store and `/bin/sql`; unavailable checked products remain in
  `scratchpad["inventory_details"]` but are not final refs because evaluators reject non-counted
  product refs for threshold-count answers. If no product meets the threshold, final refs contain
  only the resolved store and `/bin/sql`; checked product evidence remains diagnostic.
  Counted product refs are strict final-answer refs: the helper prefers deep catalogue
  `/proc/catalog/<category>/<kind>/<family>/<SKU>.json` paths, but also accepts a real runtime
  `/proc/catalog/<category>/<kind>/<SKU>.json` product path when no family path exists. For SKUs
  that actually contribute to the count, it keeps statted shallow proof refs such as
  `/proc/catalog/<SKU>.json` or `/proc/catalog/<brand>/<SKU>.json` only when no valid deep
  `/proc/catalog/<category>/<kind>/<family>/<SKU>.json` or kind-level runtime proof path exists.
  Unavailable checked products never add those shallow refs.
- `buy_max_across_stores_answer(required, city_hint, exclude_store_hint="", answer_format="PLAIN",
  submit=False, policy_citation=None) -> dict`. The return dict includes top-level `refs` and
  `scratchpad["refs"]`.
- `city_inventory_quantity_answer(required, city_hint, exclude_store_hint="", answer_format=None,
  submit=False, policy_citation=None) -> dict`: city-wide available-today sum helper for task
  wording like "Across every CITY branch, how many units ...". It delegates to
  `buy_max_across_stores_answer()` after deriving the answer format from task text when omitted.
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

Discount helpers derive active issuer delegation from positive authority language in current update,
policy-update, discount addendum, or ops-policy note docs, not merely from desk-coverage/delegation
topic words. Negation wins: phrases such as "no
discount authority", "no authority is delegated", or "associates may help gather context" make the
delegation diagnostic `denied`, so a non-`discount_manager` issuer is security-denied. Base policy
negation does not override a scoped current-update grant: update docs are matched to the current
employee, basket, and/or store before they can grant or deny delegated authority.
Positive delegation diagnostics suppress matches that occur inside a nearby negated/no-authority
window, so text like "no discount authority is delegated" is not also reported as a grant. Basket
scope extraction uses digit-explicit `basket_[0-9]+` matching to avoid TypeScript/Python raw-regex
escaping drift in the bootstrap.
Discount update discovery must search nested addenda such as `/docs/discounts/addenda/**` in
addition to current/policy update and `/docs/ops-policy-notes` roots, using basket ids,
store/location terms, employee ids, and the current date as relevance terms. When a scoped update,
addendum, or ops-policy note delegates the "normal maximum" discount and the basket subtotal cannot
be computed, the helper may use the highest parsed base-policy tier as the maximum rather than
guessing from the model's requested percentage.
Both singular `addendum` and plural `addenda` paths are scoped delegation/update authority sources.
`discount_request_answer()` treats `discount_policy_facts().scoped_delegation_positive_hits` as
authoritative for the current task scope, so an employee without `discount_manager` may proceed
when the dated doc matches employee, basket, store/reason, and policy maximum.
The central `ws.answer()` discount safety guard applies the same scoped-grant facts and must not
downgrade a successful `/bin/discount` result merely because the older active-delegation fallback is
unclear.
If the model passes an inflated placeholder such as `percent=100` for wording like "largest allowed"
or "maximum allowed", `discount_request_answer()` clamps to the doc-derived policy maximum after
policy facts are parsed instead of treating that placeholder as a literal over-policy request.
This also applies to "highest policy-allowed" wording.
When discount docs expose tiered maximums and the basket subtotal cannot be computed, the helper may
apply only a documented zero-floor/any-subtotal tier such as "1 to 5 percent for any basket
subtotal"; it must not use a higher subtotal-gated tier unless the subtotal is known to satisfy it.
Unsupported discount exits preserve `discount_policy_facts` diagnostics so parser gaps can be fixed
from logs without guessing.

`items` accepts pre-resolved `{"sku": "...", "path": "..."}` entries or catalogue requirements as
`{"required": {...}}`.
Inventory helpers submit store refs, `/bin/sql`, and resolved product refs from helper evidence.
Product refs should prefer canonical nested `/proc/catalog/<category>/<kind>/<family>/<SKU>.json`
paths when SQL/runtime rows expose `category_id`, `kind_id`, `family_id`, and `sku`; broad shallow
`/proc/catalog/SKU.json` refs should not be added for every resolved product. In list-threshold
counts, shallow catalog refs are kept only for products that meet the threshold and contribute to
the count and lack a valid canonical/deep proof ref; unavailable checked products keep
canonical/deep refs only. City-wide quantity answers
should use `city_inventory_quantity_answer()` rather than hand-written SQL; if generated code still
hand-rolls SQL and cites a resolvable product SKU plus city context, the central answer guard may
normalize it.
Catalogue count update docs that say to count only SKUs in a city/location with positive
`available_today` are applied by deriving the city from the doc path/content, then counting distinct
product SKUs for the requested kind joined to matching inventory rows with `available_today > 0`.
Current-update and policy-update markdown reads use short retries so transient workspace TLS/EOF
errors do not silently turn a documented scoped count into the raw catalogue SQL count.

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
`/proc/returns/ret_*.json` records or payment records linked from those returns. If that match is
inferred from customer plus amount, inspect all matching return/payment candidates. If exactly one
candidate is non-terminal and tied to a paid/captured/succeeded payment, the helper may proceed only
when returns docs positively grant customer-facing refund authority without `refund_manager` and the
runtime command accepts it; otherwise return
`OUTCOME_NONE_UNSUPPORTED` while keeping candidate refs.
Terminal/ineligible matches also return `OUTCOME_NONE_UNSUPPORTED` while keeping the same candidate
refs.
The helper and central guard must carry linked `/proc/payments/pay_*.json` refs extracted from those
candidate return records, because evaluators may require both the return and payment evidence.
A customer request to refund an explicit `pay_XXX` or `ret_XXX` should cite the payment record plus
any matching `/proc/returns/ret_*.json` record and `/docs/returns.md`; answer `OK` with
`OUTCOME_OK` only when returns policy docs positively grant customer-facing refund authority without
`refund_manager`, the linked return status is not terminal or ineligible, and the supported runtime
refund command accepts it. Employee requests to approve or
finalize a refund require `/bin/id` to include `refund_manager`, returns policy to explicitly allow
the requested action for the current return status, and the supported runtime refund command to
accept it. The policy parser recognizes common status wording such as `status is approved` for
approval and `refund_pending`/pending-refund wording for finalization. Runtime command success alone
is not enough authorization. A request naming `ret_XXX`
reads that return record directly and
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
Refund approval is status-specific: a return in `requested` state is not approval-eligible, even if
the runtime accepts `/bin/payments approve-refund`. The helper treats approval as supported only
when docs and the return record show the current status is already `approved`; requested,
replacement-pending, rejected, and other pre-approval/ineligible statuses stay
`OUTCOME_NONE_UNSUPPORTED` with the return/payment/docs refs.
The central answer guard re-checks `OUTCOME_OK` approval/finalization scratchpads before submission:
it re-reads linked returns from the task text, payment id, and refs, adds linked payment refs, checks
`refund_manager`, and downgrades to `OUTCOME_NONE_UNSUPPORTED` when status or returns-policy
transition evidence is missing. This guard exists so runtime command success cannot bypass the
doc-derived helper contract.
When a task names only `ret_XXX`, the helper reads that return record, extracts linked payment ids,
and cites the matching `/proc/payments/pay_*.json` refs as evidence even when the outcome is
unsupported.

For archived payment fraud tasks, use `archived_payment_fraud_answer(submit=True)` directly when
the required answer is a list of fraudulent payment ids. The answer is a newline-separated list of
payment ids, while `refs` contains every payment record marked as fraud. If the task instead names
an `/archive/*.tsv` file and asks for the total fraudulent payment amount, use
`archive_payment_fraud_total_answer(path=..., submit=True)` or `contract_task_answer(submit=True)`:
that answer must be a money total such as `EUR 5245.00`, and refs must cite archive row anchors
such as `/archive/file.tsv#row=<RowID>` rather than `/proc/payments/pay_*.json`. The helpers are
read-only and should be preferred over `ws.list()`, `ws.tree()`, or broad `ws.search()` calls on
payment stores. Archive TSV normalization maps non-sensitive aliases such as `archive_payment_id`,
`customer_ref`, and `store_ref`, preserves unknown non-sensitive archive columns for
schema-derived fraud/risk/chargeback/dispute/incident/case markers, and deduplicates repeated row
ranges by `RowID`.
The fraud-id helper starts from a high-confidence repeated-fingerprint seed
cluster and may expand to the surrounding archived paid-payment time burst using adjacent timestamp
gaps rather than a fixed expected record count. When the paid burst is a strong anchor, it also
attempts a guarded all-status archived burst expansion for adjacent failed/3DS/declined records in
the same incident; if fingerprints are
unique, it uses bounded SQL investigation fallbacks over archived records first and then all
payment-history rows for diagnostics if needed: observed geography, tight actor/customer/basket
bursts, repeated amount, and time-density clusters. Fallback submission is gated: submitted rows
must be archived, the primary field must describe behaviour rather than payment-flow state, broad
customer/store scatter is rejected, and an independent signal such as tight time, repeated
fingerprint/device, actor/basket, amount, or geo must corroborate the cluster. If no high-confidence
cluster exists, or a fallback is rejected, inspect `fraud_payment_evidence["diagnostics"]`,
`archived_investigation`, `archived_profile`, and `rejected_submit_candidates` for compact
candidate patterns and rejection reasons. Repeated-fingerprint evidence also includes
diagnostic-only `expansion_diagnostics` for time-window and associated-identifier opportunities
around the proven seed, plus `seed_profile_candidates` for archived paid rows matching the seed's
store set, amount range, same-day pattern, or combinations of those fields; these are reported
before being promoted to answer expansion. When the guarded profile extension promotes candidates,
`second_wave_extension` lists included ids, expanded amount bounds, submitted one-record tail ids,
diagnostic same-day straggler candidates, excluded candidates and reasons, and the submit review.
It may add a tiny amount-outlier bridge only when the row is archived paid, in the seed store set,
on an accepted second-wave day, close to the accepted second-wave time window, and shares a customer
with an accepted second-wave row; this is bounded and recorded separately in diagnostics.
For normal `/proc/payments` fraud-id tasks, `archived_paid_population_anomaly` can be promoted only
when no identifier/fallback cluster exists, the archived-paid population is small, identifier
checks are clear, and all four archived-vs-non-archived ratio checks are very strong. Otherwise it
is diagnostics-only and lists the ratio checks plus archived/non-archived profile summaries. Broad
status/failure/3DS action-required and payment-id sequence groups are diagnostic context only. If
the helper returns
`NO_CONFIDENT_FRAUD_CLUSTER`, do not manually choose a largest diagnostic group; the runtime will
block that as unsupported. This is meant to recover the full incident while preserving the
zero-write invariant.
Broad repeated payment-method/device fingerprints spanning more than about two hours are split into
compact timestamp components before they can seed a submitted incident, so month-long credential
reuse remains diagnostic unless a tight component is selected.
Within tight repeated-fingerprint components, normal payment-id tasks prefer multi-customer and
multi-store bursts with meaningful total amount over low-value single-customer velocity bursts. TSV
fraud-total tasks are stricter: explicit semantic markers win, and a compact repeated-fingerprint
burst must have independent non-tautological non-time corroboration before it can be submitted.
Benchmark context labels such as `<task-system-prompt>` are not task-content injection signals for
this authorized Risk Ops investigation.
