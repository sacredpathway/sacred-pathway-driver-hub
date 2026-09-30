# Phase A — Web shell + operations dashboard

Branch `phase-a/web-dashboard-redesign` (from `phase0.5/compat-security`). No
migrations, no production data changes, no settlement builder, no Next.js /
Cloudflare changes.

## KPI definitions (all from real rows; `lib/dashboard/kpis.ts`)

| KPI | Calculation |
|---|---|
| Active loads | Loads that are **not cancelled** and **not delivered**. Delivered = status group completed/settled (`delivered`, `completed`, `ready_for_settlement`, `settled`) **or** `delivery_date <= today` (iOS `isCompleted` parity). Not period-filtered. |
| Delivered this week | Delivered loads (rule above) whose period date (`delivery_date → pickup_date → created_at`, `lib/loads/periodDate`) falls Monday → today (UTC, `resolveRange("this_week")`). Hint shows Σ `total_revenue` of those loads. |
| Gross revenue | Σ `loads.total_revenue` for loads attributed to the selected period by `lib/loads/periodDate` — identical set to the previous dashboard tile and the Revenue report. Cancelled loads remain included (unchanged behaviour); any cancelled amount is shown in the hint. |
| Expenses | Σ `expenses.amount` for the selected period by `expenses.created_at` (unchanged rule). |
| Revenue / mile | Σ revenue of period loads with `total_miles > 0` ÷ Σ their miles; "—" when no miles. |
| Active drivers (admins) | `drivers.active != false` of the roster count. |

Removed on purpose: **Net profit** (revenue − logged expenses ignores driver pay, so it
overstated profit), **Pending payroll** / driver est-pay card (legacy paystub model).
Driver pay returns in Phase D from the settlement engine.

Money sums use the Decimal `Money` type (exact to the cent).

## Attention Required rules (`lib/dashboard/attention.ts`)

Cancelled and settled loads are never flagged.

1. **Delivery date passed** — status Assigned/Dispatched/Picked Up/In Transit and `delivery_date < today`.
2. **No driver assigned** — active load, `driver_id` null (carrier admins only).
3. **No delivery date** — active load, `delivery_date` null (it is counted by pickup date until set).
4. **No rate entered** — `total_revenue` null or 0.
5. **No rate confirmation attached** — delivered load with no `documents` row of type `rate_confirmation` for it (skipped entirely if the documents read fails, and for sponsored drivers who can't read carrier documents).

## Recent settlements

Only rows produced by the settlement engine: `settlements.engine_version IS NOT NULL AND is_estimate IS NOT TRUE`.
Legacy iOS settlements (no engine version) and web paystubs are not shown. Empty → empty state; read error → error message.

## Visual QA method

Rendered with a throwaway copy of the app whose Supabase client and middleware were
replaced by an in-memory fixture (never committed), screenshotted with Playwright at
1440 / 1280 / 768 / 390.
