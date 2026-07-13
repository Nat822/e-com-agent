# Tuning Backlog

> Pending verification and improvement items. After completing an item, mark `[x]` and note the result.
> After each session, add new items here.

## Pending verification runs

- [ ] Run focused `t13,t46` dev rerun to verify inventory ref normalization and policy-maximum discount clamping.
- [ ] Run focused `t26` dev rerun to verify employee-store fallback for last-checkoutable basket selection.
- [ ] Run focused `t47,t48` dev rerun to verify canonical quote property parsing and chunked archive fraud-total reads.
- [ ] Run focused `t38,t40,t48` dev rerun to verify approved population-anomaly submission, repeated-fingerprint diagnostics, and stricter TSV fallback rejection/selection.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t45,t46,t49,t50 --concurrency=1` to verify zero-count inventory proof refs, max-applicable discount clamping, catalogue SQL-incident refs, and guarded newest-basket checkout.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t08,t13,t22,t26,t43,t45,t49,t50 --concurrency=1` to verify typo-tolerant catalogue matching, inventory threshold refs/counting, checkout ambiguity/safety, current-store discount selection, refund outcome normalization, and lowercase count formatting.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t13,t43,t45,t49 --concurrency=1` to verify uppercase/lowercase count formatting, compact lowercase count formatting, shallow proof-ref filtering, and amount-only customer refund execution.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t49 --concurrency=1` to verify fallback-derived kind IDs let city-scoped positive-inventory count docs override bounded directory counts after SQL spool errors.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t49 --concurrency=1` to verify `<ANSWR: %VALUE%>` custom count formatting and required ops-policy count refs are preserved.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t49 --concurrency=1` to verify `<count: NUMBER>` spacing and doc-derived kind-id inference for city-scoped positive-inventory count docs.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t49 --concurrency=1` to verify compact `<total:%VALUE%>` formatting and file-backed positive city-inventory count fallback after SQL spool errors.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t26,t27,t28,t30,t31,t41 --concurrency=1` to verify the dynamic discount/3DS helper refinements.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t23,t24,t25,t42 --concurrency=1` to confirm security/discount refs and delegated t42 behavior stay correct.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t38,t39,t40 --concurrency=1` and inspect `fraud_payment_evidence.diagnostics`, especially `t38`, before adding another fraud selector.
- [ ] After the next `t38,t39,t40` run, inspect `archived_profile` and `seed_profile_candidates` specifically before promoting any profile-matching logic to submitted fraud refs.
- [ ] After the next `t38,t39,t40` run, inspect `second_wave_extension` and `archived_paid_population_anomaly.submit_review` for false-positive risk before broadening any profile thresholds.
- [ ] After the next `t38,t39,t40` run, confirm the expanded amount range and one-record tail rule improve `t40` without reducing `t38/t39` from 100% or introducing false positives.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t43,t44 --concurrency=1` to verify generic refund requests cite matching return refs and approval tasks do not mutate unsupported return statuses.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t15,t43 --concurrency=1` to verify validated kind-level inventory refs and doc-gated customer refund outcomes.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t13,t14,t40,t44 --concurrency=1` to verify counted shallow refs, bounded second-wave fraud expansion, and refund-manager approval.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t32 --concurrency=1` to verify support-note catalogue claim checks cite the exact checked size/color SKU.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t38,t39,t40 --concurrency=1` to verify population-anomaly false positives are blocked while repeated-fingerprint and second-wave recovery stay intact.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t38,t39,t40,t43,t48 --concurrency=1` to verify strict population anomaly, same-day second-wave stragglers, guarded t40 behavior, amount-only customer refunds, and stricter TSV dense-window rejection.
- [ ] After the next SQL-spool catalogue/count failure, verify `sql_incident_refs()` cites the content-matched `/docs` or `/bin` incident doc rather than a filename-specific hardcoded ref.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t01,t20,t26,t42,t43,t44 --concurrency=1` to verify canonical refs, discount delegation negation, refund clarification/unsupported split, and last-checkoutable basket resolution.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t05,t07,t12,t13,t17,t32,t42,t43 --concurrency=1` to verify support-claim refs/property recovery, count update parsing, inventory/buy-max refs, scoped discount grants, and amount-only refund outcomes.
- [ ] Run a focused dev bench sample covering inventory availability and buy-max-across-stores tasks.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t01,t08,t13,t14,t15,t16,t20,t32,t38,t39,t40,t45,t47 --concurrency=1` to verify SQL-missing `/proc` fallbacks for catalogue, inventory, quote, and payment-fraud families.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t11,t12,t13,t14,t15,t16,t17,t18,t19,t20,t22,t33,t38,t39,t40,t45,t46,t47 --concurrency=1` to verify schema-adaptive SQL adapters remove 180s catalogue/inventory/payment timeouts.
- [ ] Run focused `npx.cmd tsx runs/run.ts --bench=bitgn/ecom1-dev --tasks=t23,t24,t25,t26,t28,t35,t37,t42,t43,t44 --concurrency=1` to verify dynamically discovered security/discount/payment/returns rule facts preserve safety outcomes without adding noisy refs.
- [ ] Add helper-level tests for `detect_answer_format`, `format_answer`, `catalog_answer_existence`, and inventory helpers.
