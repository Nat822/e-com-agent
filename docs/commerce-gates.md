# Commerce Gates

> Evaluated in this sequence. Each gate can block the task with the listed outcome.

| # | Gate | Fires when | Outcome if blocked |
|---|---|---|---|
| 1 | **Policy gate** | No policy rule found for the action | `OUTCOME_NONE_CLARIFICATION` |
| 2 | **Fraud gate** | Requested discount > `policy_book.max_discount_pct`, or override/bypass request | `OUTCOME_DENIED_SECURITY` |
| 3 | **Customer identity gate** | No exact match on `customer_id` or email | `OUTCOME_NONE_CLARIFICATION` |
| 4 | **Payment safety gate** | 3DS recovery method not in policy, or ineligible installment offer | `OUTCOME_DENIED_SECURITY` |
| 5 | **Delivery evidence gate** | Missing package with no carrier scan data read first | (forces read before deciding) |
| 6 | **Inventory gate** | Product stock=0 being recommended/added to cart | `OUTCOME_NONE_CLARIFICATION` |
| 7 | **Authorization direction gate** | Action on another customer's account without requester-side auth | `OUTCOME_NONE_CLARIFICATION` |

## Gate change rules

- **Gate changes are surgical.** Change one gate at a time, measure the delta, then move to the next.
- Gate logic lives in `agent/system-prompt.ts`. Do not scatter gate checks into the runner or helpers.
- After changing any gate, run a focused dev bench to measure the scoring impact before proceeding to the next gate.
