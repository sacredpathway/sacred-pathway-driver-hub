# Web Settlements — the live payroll workflow on the web

**Status:** built and tested locally · **not deployed** · migration **not applied**
**Date:** 2026-10-23 · **Owner decision:** the iPhone settlement model is the single live payroll system on web and iOS. Web paystubs are read-only legacy history.

## What the person doing payroll gets

| Need | Where |
|---|---|
| Start payroll | **Settlements → + New settlement**: pick the driver and the week. Loads delivered that week are pre-checked; loads already paid elsewhere are shown but blocked. |
| Edit everything | `/settlements/[id]`: period, settlement #, type, truck, hours, notes, the driver pay method (percentage / per mile / flat / salary / hourly / manual, or a combination), company fees and who pays them, every load line (number, dates, route, broker, miles, linehaul, FSC, accessorials, detention, layover, TONU, lumper, gross override, custom pay for one load), and every addition and deduction (category, description, amount, who pays, split %). |
| Add a category | Any category dropdown → **+ New category…** Manage them in **Settings → Payroll categories**. |
| Exact amounts | Money is entered and stored to the cent. `$12.345` is rejected with a message, never rounded silently. Per-mile rates keep up to 6 decimals ($0.585/mi), percentages up to 4, split shares up to 3. |
| Totals | Recalculate live while typing (gross, driver earnings, additions, deductions, **net pay**, company expenses, company retained, revenue per mile, every statement line). |
| Finalize / pay | **Finalize (approve)** → **Mark paid** (method + reference). |
| Locks | Approved, paid and voided settlements are read-only. **Reopen** (and **Void** once approved/paid) need a reason, which is saved in the audit trail. |
| Audit log | Every save, line change, category change, pay-rule change, recalculation and status change is written to `settlement_audit_events` with who and when, and shown on the settlement. |
| Past payrolls | **Payroll History** (`/payroll`): one searchable list of all settlements (web and iPhone), older iPhone settlements and legacy paystubs. You can search by settlement or paystub #, driver, load #, amount or notes, filter by driver, status, type and dates, and sort by date or net pay. Paid and open totals are exact to the cent. |

## iPhone parity (why the cents match)

`web-app/lib/settlements/engine.ts` is a line-for-line port of `SettlementCalculationEngine.swift` (`settlement-engine/1.0`):
- It uses exact decimals (decimal.js through `lib/money/money.ts`, the twin of `Money.swift`) and never floats.
- It rounds half away from zero, and only at a line or a total. Every total is the sum of the rounded lines.
- The order of operations is the same: company fees are expanded into deduction lines, percent-of-net is allocated with the residual on the largest load, and settlement-level salary/hourly/manual lines are added. The driver share and the company share of each deduction are each rounded.
- The statement text (`pay_basis_description`) is character-for-character what the iPhone prints.
- Before the engine runs, values are snapped to the precision each column stores. A settlement saved on the web therefore recalculates to the same cents from the stored rows, on the web or on the iPhone.

`engine.test.ts` ports every golden case from the iPhone's `SettlementCalculationEngineTests.swift`.

## iPhone compatibility rules (do not break)

- The iPhone decodes whole tables with strict enums. The web therefore writes only the iPhone's category, status, responsibility, pay-kind and **audit-action** strings, and the `PayRule` / `fee_terms` JSON keys.
- **Custom categories never write a new category string.** A line stores a standard *report-under* category (default **Other**), with the custom name as its description, plus `custom_category_id` (new nullable column). The iPhone ignores the column. Its upserts don't send it, so they keep it (this is proven in the DB test).
- Saves are guarded by `updated_at`. An edit made on the iPhone in the meantime is never overwritten silently; the web asks you to reload.
- Approving on the web runs the same side effects as the iPhone. It assigns the settlement number, records advance repayments for the driver share, and flags the loads `settled`. Void and reopen release those. The database double-pay guards (20261001120100) still apply.

## Legacy web paystubs

`lib/payroll/legacy.ts` → `LEGACY_PAYSTUBS_READ_ONLY = true`.
- All 13 write actions in `app/(app)/payroll/actions.ts` refuse to run.
- `/payroll/[id]` shows the paystub read-only, and print/PDF still work. `/payroll/new` redirects to `/settlements/new`.
- No paystub row is deleted, migrated or modified.
- The old "Convert legacy settlement to paystub" action now refuses.

## Database changes — need approval before applying (apply in this order)

1. `supabase/migrations/20261023120000_payroll_custom_categories.sql` (additive, idempotent, rollback included)
   - It adds the table `payroll_custom_categories`, with RLS restricting each account to its own rows, a check that names are unique per kind regardless of case, and a CHECK that `base_category` is a value the iPhone accepts.
   - It adds the nullable column `custom_category_id` to `settlement_additions` and `settlement_deductions`, with `ON DELETE SET NULL`.
2. `supabase/migrations/20261023130000_web_settlement_atomic_writes.sql` (additive, idempotent, rollback included)
   - **`sph_web_save_settlement(jsonb)`** saves or creates a settlement in ONE transaction: header, lines (prune → upsert) and audit. It row-locks the settlement and refuses unless all of these hold: the settlement is yours, it is not an estimate, its status is draft or ready for review, `updated_at` matches what the editor loaded, and no line id belongs to another settlement or account.
   - **`sph_web_transition_settlement(jsonb)`** changes status in ONE transaction. It covers the status itself, the iPhone's transition table, the reopen/void reasons, advance repayments (computed from the stored lines as the driver's share), advance balances (never over-recovered), load `settled` flags and their release, and audit. The existing double-pay trigger fires inside it.
   - Both are SECURITY INVOKER (RLS is unchanged), callable by `authenticated` only, and only write iPhone audit actions.
   - #1 and #2 are applied in production (recorded as `20261024011809` and `20261024012624`).
3. `supabase/migrations/20261023140000_settlement_lock_order.sql` (forward-only, **not applied**)
   - `CREATE OR REPLACE` of the two functions above, byte-identical to #2 except one lock block each (proved by `web-app/lib/settlements/lockOrderMigration.test.ts`). The status change locks the settlement's loads `FOR UPDATE` in id order before the status update; the save takes `FOR KEY SHARE` on referenced loads and advances in id order before writing lines. Same signatures, payloads, errors and grants; no table, row or policy changes. Fixes the C6/C7/C8 deadlocks.

**The web has no fallback.** Settlement saves on the web need both migrations. Until they are applied, a save is refused with a clear message and nothing is written.

## Database tests (throwaway local Postgres; never touch Supabase)

| Suite | What it covers | Result |
|---|---|---|
| `supabase/tests/web_settlements/run.sh` | Builds a production-shaped schema: the base tables plus the iPhone repo's settlement migrations, vendored verbatim. The existing web payment guards, the document-automation migration and the three new migrations are then applied twice, in production order, on PostgreSQL 17. The suite covers atomicity, locks, reopen/void, concurrency races (C1–C9, with global invariants), duplicates, advance limits, double pay, iPhone compatibility, the app's real save JSON and history preservation. | 133 PASS |
| `supabase/tests/payroll_custom_categories/run.sh` | Category table, RLS, iPhone-safe base category, iPhone-style upsert keeps the pointer | 14 PASS |
| `supabase/tests/paystub_payment_integrity/run.sh` | Existing suite, unchanged | 153 PASS |

## iPhone ↔ web differences — resolved / remaining

| Topic | Resolution |
|---|---|
| Half-cent rounding | **Resolved, iPhone rule kept.** The iPhone builds legacy rules (no stored `pay_rule`, only `driver_pay_percentage`) with Foundation `Decimal(Double)`, which gives `Decimal(33.33)` = `33.32999999999999488`. 33.33% of $50.00 is exactly $16.665, so the iPhone pays **$16.66**. The web now reproduces `Decimal(Double)` exactly (`lib/money/swiftDecimal.ts`, verified against Apple-reported values and 280 simulated rates) and stores the same effective rule the iPhone stores on recalculation. Rules typed as "33.33" are exact on both apps and pay $16.67. |
| Undelivered loads | **Resolved.** The web now uses the iPhone rule: only completed loads (ready for settlement or settled, or delivery date ≤ today) can go on a settlement. Future deliveries are shown but can't be selected, and the server re-checks. "Today" is the browser's local day (the iPhone uses the device day), accepted only within ±1 day of the server clock. |
| Editing finalized settlements | **Resolved in iPhone 2.3.7 (not yet released).** Both apps refuse every edit of approved, paid or voided settlements unless they are reopened with a reason. iPhone 2.3.5/2.3.6 still let an approved settlement be edited. Once every phone is on 2.3.7, the database lock (`REVIEW_BEFORE_APPLYING_20261024120000_lock_finalized_settlements.sql`) enforces it for both apps. |

## Known limits / follow-ups

1. **Coordinated iPhone update: built as 2.3.7 (see below), not yet released.**
2. Advances: like the iPhone default, recovery is **manual**. Recovery lines created on the iPhone are kept and repaid on approval.
3. Pre-itemized iPhone settlements (no engine version, no lines) are read-only history.
4. The driver stays the same once a settlement is created.
5. Approving a settlement whose stored totals are stale refreshes them **inside the same transaction** as the approval. If the approval is refused, the refresh is rolled back too.

## Independent reviews (2026-10-23)
- **Round 1, fixed:**
  - New row ids are minted on the server.
  - Same-status transitions are refused.
  - The iPhone's `advance_over_recovery` and `expense_already_linked` checks now block approval.
  - Reopen audit rows follow the iPhone rule.
  - Loads with a blank status get flagged on approval.
  - Split fee terms are kept.
- **Round 2 (atomic writes):** the database suite itself caught 2 defects, both fixed and covered by tests:
  - an invalid `WITH ORDINALITY` audit insert;
  - another account's line id was silently skipped instead of refused (a post-write row-count check now refuses the whole save).
- **Round 3 (review of the atomic functions), all fixed with regression tests:**
  - A missing or null target status could skip the guards and blank the status (high).
  - Two approvals recovering the same advance could deadlock. Advances are now locked in id order first, and 25/25 races finish with 0 deadlocks.
  - **Round 4 (lock order, migration #3 `20261023140000_settlement_lock_order.sql`, not yet in production):** voiding or reopening an approved settlement while approving another settlement with the same loads deadlocked (races C6/C7: 1–12 per 100 against production's #2), and so did a draft save adding those loads (C8). The void/reopen updated the loads in scan order and the save's foreign-key checks locked them in payload order, while the approval guard locks them in id order. #3 makes both functions lock the loads (and the save the advances) in id order first; #2 is unchanged. C6 ×100, C7–C9 ×50 and 7 global invariants now pass with 0 deadlocks.
  - A status change could be written without an audit row. The move's own audit row is now required.
  - A stale-total refresh could survive a refused approval. It now runs in the same transaction.
  - A blank settlement number counted as a number.
  - Create ignored column defaults.

## iPhone 2.3.7: coordinated update (built and tested locally, not released)

- **Approved = read-only.** Approved, paid and voided settlements can't be edited on the iPhone. You reopen to draft with a reason first, and the reason is audited. The reason table is identical to `sph_web_transition_settlement`: approved→draft, paid→approved, voided→draft and approved/paid→voided need a reason; draft or ready-for-review → voided doesn't.
- **All-or-nothing on the iPhone too.** Cloud saves call `sph_web_save_settlement` and status changes call `sph_web_transition_settlement`. Each sends the version the editor started from, so an edit made on the web in the meantime is refused, never overwritten. The iPhone falls back to the old direct table writes **only** if the function isn't deployed (PGRST202, or a 42883 that names the function).
- **Custom categories.** The iPhone decodes and round-trips `custom_category_id`, so it never wipes it, and shows the custom name. If you change a line's category on the iPhone, its pointer is dropped.
- **Changes to 20261023130000 (still unapplied):**
  - The version check tolerates 1.5 ms, because Swift dates travel at millisecond precision.
  - Header `truck_id` and `pdf_storage_path` are carried.
  - Line document ids are written on insert only, so a web save can't clear them.
  - The transition marks its own update with `sph.in_transition` for the lock.
- **The database proves it** with `supabase/tests/web_settlements/40_ios_payload.sql`, which executes the iPhone's real payloads (`generated/ios_*.json`).
- **Database lock (draft):** `REVIEW_BEFORE_APPLYING_20261024120000_lock_finalized_settlements.sql`, tested by `50_lock_finalized.sql`.
  - Every direct write to a finalized header or line is refused, including a status-only PATCH and a direct nulling of `load_id`.
  - FK cascades and settlement deletes still work.
  - Apply it only after 2.3.7 is live **and** `minimumSupportedVersion` = 2.3.7 in `force-update.json`.
