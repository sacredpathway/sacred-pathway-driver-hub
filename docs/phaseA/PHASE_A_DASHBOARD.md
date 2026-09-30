# Phase A — Web shell + operations dashboard

Branch `phase-a/web-dashboard-redesign` (from `phase0.5/compat-security`). No
migrations, no production data changes, no settlement builder, no Next.js /
Cloudflare changes.

## Owner rule (2026-09-30)

The app does **not** track whether a load is picked up or dropped off. As soon as a
load's paperwork is entered it counts as delivered, and the dashboard only calculates
what is on the paperwork. Load status is not used for any dashboard figure (the only
exception: cancelled loads are never flagged for missing paperwork). The Status
column added to the Loads list earlier in Phase A was removed again; the load detail
page is back to its pre-Phase-A display.

## KPI definitions (all from real rows; `lib/dashboard/kpis.ts`)

All figures use the selected period. Loads are attributed by
`delivery_date → pickup_date → created_at` (`lib/loads/periodDate`).

| KPI | Calculation |
|---|---|
| Loads | Number of loads in the period. |
| Gross revenue | Σ `loads.total_revenue` — identical set and sum to the previous dashboard tile and the Revenue report. Any cancelled amount is shown in the hint. |
| Miles | Σ `loads.total_miles`; hint shows how many loads have miles. |
| Revenue / mile | Σ revenue of loads with `total_miles > 0` ÷ Σ their miles; "—" when none. |
| Expenses | Σ `expenses.amount` for the period by `expenses.created_at` (unchanged rule). |
| Active drivers (admins) | `drivers.active != false` of the roster count. |

Removed on purpose: **Net profit** (revenue − logged expenses ignores driver pay),
**Pending payroll** / driver est-pay card (legacy paystub model). Driver pay returns in
Phase D from the settlement engine. Money sums use the Decimal `Money` type.

## Missing paperwork info (`lib/dashboard/attention.ts`)

Checks loads dated in the **last 30 days** (delivery → pickup → created), skipping
cancelled loads. Status is never checked.

1. **No rate entered** — `total_revenue` empty or 0.
2. **No miles entered** — `total_miles` empty or 0.
3. **No driver assigned** — `driver_id` empty (carrier admins only).
4. **No delivery date** — counted by pickup date until one is set.
5. **No rate confirmation attached** — no `documents` row of type `rate_confirmation` for the load (skipped if the documents read fails, and for sponsored drivers).

## Recent loads

The period's loads, newest paperwork first: load, driver, origin, destination, pickup,
delivery, miles, rate. No status.

## Recent settlements

Only rows produced by the settlement engine: `settlements.engine_version IS NOT NULL AND is_estimate IS NOT TRUE`.
Legacy iOS settlements (no engine version) and web paystubs are not shown. Empty → empty state; read error → error message.

## Visual QA method

Rendered with a throwaway copy of the app whose Supabase client and middleware were
replaced by an in-memory fixture (never committed), screenshotted with Playwright at
1440 / 1280 / 768 / 390.
