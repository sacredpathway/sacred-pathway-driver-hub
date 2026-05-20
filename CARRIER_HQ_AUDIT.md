# Carrier HQ Web — Audit & Build Plan
Sacred Pathway Driver Hub · 2026-05-20

> **TL;DR** — You already have ~60% of Carrier HQ built. `web-app/` is a working Next.js 15 + Supabase SSR scaffold deployed to Cloudflare Pages. Backend has 11 RLS-secured tables already in use by iOS. Biggest gaps: write parity, paystub generator, drivers/trucks/trailers fleshed out, dispatcher roles. Zero iOS changes required — additive-only DB migrations.

---

## 1. What web code already exists

### `/web-app/` — the real Carrier HQ foundation (KEEP, BUILD ON THIS)
**Stack:** Next.js 15.0.3 (App Router) + React 18 + TypeScript + Tailwind + `@supabase/ssr` + Edge runtime → Cloudflare Pages.

**Already wired:**
- Auth: `/auth/signin` (Supabase Auth UI), `/auth/signout`, `/auth/callback`, HTTP-only-cookie sessions via `@supabase/ssr`
- Middleware: route protection + session refresh (`middleware.ts`)
- App shell: top-nav, mobile drawer, signed-in user email, sign-out
- Read-only pages: `/dashboard`, `/loads`, `/brokers`, `/broker-contacts`, `/expenses`, `/documents`
- Brand tokens: `sp-gold`, `sp-background`, `sp-textPrimary` via Tailwind config
- Deploy: `wrangler.toml` set to project `driver-hub-web`, anon-key + URL env vars
- Domain: app already references `app.sacredpathway.org` (iOS `Config.Web.dashboardURL`)

**Not yet built:** create/edit/delete UIs, settings, reports, paystub generator, settlements, documents upload, drivers CRUD, loads CRUD.

### `/web/` — legacy static HTML (ARCHIVE / DELETE)
Plain HTML mirror (`dashboard.html`, `loads.html`, …) — prototype work superseded by `web-app/`. Move to `/web-legacy/` or delete to avoid two web codebases.

### Marketing/legal pages (KEEP)
`index.html`, `privacy.html`, `terms.html`, `support.html`, `sacred-pathway-site/` — Squarespace-adjacent assets. Unrelated to Carrier HQ.

### Already-written plan
`DRIVER_HUB_WEB_PLAN.md` (Phases W1–W4) — your existing roadmap. This document supersedes parts of it for Carrier HQ scope.

---

## 2. Backend (Supabase) — what exists today

**Postgres tables (all RLS-enabled, all keyed `profile_id = auth.uid()`):**

| Table | Status | Notes |
|---|---|---|
| `profiles` | ✅ Complete | Company info, MC#, DOT#, pay-split defaults, subscription tier |
| `drivers` | ✅ Complete | Name, truck#, pay_type (percent/flat), flat_rate, contact |
| `loads` | ✅ Complete | Broker, origin/dest, miles, line haul, FSC, accessorials, revenue, broker rep snapshot |
| `expenses` | ✅ Complete | Category, amount, vendor, fuel gal/PPG, DEF gal/PPG/total, receipt_date |
| `documents` | ✅ Complete | document_type, storage_path, raw_text, status, retry_count, OpenAI extraction |
| `settlements` | ✅ Complete | Period, totals, driver pay %, dispatcher/factoring fees, net_pay, pdf_storage_path, status |
| `brokers` | ✅ Complete | broker_name, MC#, totals (rollup) |
| `broker_contacts` | ✅ Complete | name, email, phone, phone_extension |
| `compliance_documents` | ✅ Complete | category (company/truck/trailer/driver), expiration_date |
| `ifta_entries` | ✅ Complete | state_code, miles, gallons, PPG |
| `daily_inspections` | ✅ Complete | DVIR pre/post-trip, defects, signature, photos |

**RLS policies:** `FOR ALL USING (profile_id = auth.uid())` on every table. broker_contacts joins through brokers. Web app already inherits this for free — same anon key, same RLS, no service-role needed.

**Storage buckets:**
- `documents` (private, 20MB cap, JPEG/PNG/HEIC/PDF) — RLS keys on `(storage.foldername(name))[1] = auth.uid()::text` (lowercase UUID — memory rule)
- `compliance-docs` (private) — same RLS pattern
- `inspection-photos`, `settlements`, `branding` — referenced in plan, exist or trivial to add

**Edge Functions:**
- `extract-document` — OpenAI vision rate-con/BOL extraction
- `generate-insights` — AI lane insights
- `delete-account` — GDPR-style purge
- `_shared` — helpers

**Auth providers enabled:** Apple Sign In (Services ID `com.demarquishinton.sacredpathway.web` for web), email+password, magic link.

---

## 3. What can be reused from the iOS app

These Swift services are pure logic — port to TypeScript, run in Next.js server actions or Edge functions.

| iOS file | LOC | Reuse strategy |
|---|---|---|
| `SettlementEngine.swift` | 90 | **Direct port** — pure math. ~50 lines of TS. |
| `PaystubPDFService.swift` | 1,024 | **Replace with HTML→PDF** on web (Puppeteer or `@react-pdf/renderer`). Keep same layout/branding. |
| `SettlementHTMLPDFService.swift` | 634 | **Reuse the HTML template** — already HTML-based. Render server-side, print via headless Chrome. |
| `CPAExportService.swift` | 505 | **Port** — produces CPA tax package; same math, TypeScript output. |
| `InsightsService.swift` | 848 | **Port or call existing Edge Function** `generate-insights`. |
| `BrokerIntelligenceService.swift` | – | **Port** — broker dedup + rep attribution. |
| `IFTACalculator.swift` | – | **Port** — state-by-state miles/gallons math. |
| `PaystubExpenseMatcher.swift` | – | **Port** — matches expenses to loads in a settlement period. |
| `PayWeekService.swift` | – | **Port** — Monday-start ISO week boundary logic (memory rule). |
| `DistanceService.swift` | – | **Port or replace** with Mapbox/Google Distance API. |
| `LocalDocumentParser.swift` | – | **Skip on web** — server-side parsing already lives in Edge Function. |

**Data models** (`SacredPathway/Models/*.swift`) — already mirrored in `web-app/lib/supabase/types.ts`. Just extend that file as new tables ship.

**What CANNOT be reused (iOS-only):**
- StoreKit / IAP code (web uses Stripe)
- VisionKit document scanning (web uses file upload)
- Apple Sign In native (web uses Supabase Apple provider)
- All `Views/*.swift` SwiftUI screens (rebuild in React)

---

## 4. New tables/features required for full Carrier HQ

The current schema covers ~80% of Carrier HQ. Here's the gap list — every one is **additive only**, no breaking iOS changes.

### Critical (Phase W2 — Paystub Generator)
- **`paystub_line_items`** — NEW TABLE
  - `settlement_id` FK, `kind` (deduction/reimbursement/advance/bonus/detention/toll/fuel_adv/other), `label`, `amount`, `notes`
  - Why: current `settlements` row has fixed columns only — no way to add ad-hoc bonuses, advances, or per-load reimbursements
- **`settlements`** — ADD COLUMNS
  - `paystub_number` TEXT (e.g. PS-2026-00041), `paystub_pdf_url` TEXT, `emailed_to` TEXT[], `emailed_at` TIMESTAMPTZ, `paid_at` TIMESTAMPTZ, `payment_method` TEXT (zelle/ach/cash/check), `external_settlement_id` TEXT
- **`drivers`** — ADD COLUMNS
  - `address`, `city`, `state`, `zip`, `ssn_last4` (optional), `cdl_number`, `cdl_state`, `cdl_expiration` DATE, `hire_date` DATE, `termination_date` DATE, `dob` DATE, `emergency_contact_name`, `emergency_contact_phone`

### High value (Phase W3 — Fleet & Recons)
- **`trucks`** — NEW TABLE
  - `id`, `profile_id`, `truck_number`, `vin`, `make`, `model`, `year`, `plate`, `state`, `purchase_date`, `purchase_price`, `monthly_payment`, `insurance_carrier`, `insurance_expiration`, `inspection_expiration`, `current_odometer`, `active`
- **`trailers`** — NEW TABLE
  - `id`, `profile_id`, `trailer_number`, `vin`, `make`, `model`, `year`, `plate`, `state`, `inspection_expiration`, `active`
- **`recons`** (factoring/broker settlements received) — NEW TABLE
  - `id`, `profile_id`, `factoring_company`, `recon_number`, `recon_date`, `total_advanced`, `total_reserve`, `fee_amount`, `pdf_storage_path`, `status` (received/processed/paid), `notes`
- **`recon_load_links`** — NEW TABLE
  - `recon_id` FK, `load_id` FK, `amount`, `fee` — link a recon to multiple loads
- **`loads`** — ADD COLUMNS
  - `truck_id` UUID, `trailer_id` UUID, `recon_id` UUID, `paid_at` TIMESTAMPTZ, `notes` TEXT, `commodity` TEXT, `weight_lbs` INT, `temp_min`/`temp_max` (reefer)

### Carrier HQ (Phase W4 — Multi-user / Dispatcher)
- **`org_members`** — NEW TABLE
  - `id`, `profile_id` (owning carrier), `user_id` (auth.users), `role` (owner/admin/dispatcher/accountant/driver), `invited_email`, `invited_at`, `accepted_at`, `active`
- **`activity_log`** — NEW TABLE
  - `id`, `profile_id`, `actor_user_id`, `action`, `entity_type`, `entity_id`, `metadata` JSONB, `created_at`
  - Why: with multiple users editing, need an audit trail
- **All existing RLS policies** — extend to `profile_id = auth.uid() OR profile_id IN (SELECT profile_id FROM org_members WHERE user_id = auth.uid() AND active)`

### Nice-to-have (Phase W5)
- **`broker_rates`** (rate intelligence) — `lane_from`, `lane_to`, `avg_rate_per_mile`, `sample_size`, computed view from loads
- **`subscriptions_web`** — Stripe customer/subscription tracking for web-Pro (separate from iOS StoreKit entitlement)

---

## 5. Safest build plan — won't break iOS

### Guardrails (locked)
1. **All schema changes are additive.** `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, new tables, new buckets. **Never** rename, never drop, never tighten a `NOT NULL`.
2. **iOS code is frozen** for Carrier HQ work. v2.1.0 build 30 is in Apple's review queue (2026-05-19 memory) — don't touch it.
3. **Branch:** new `feature/carrier-hq` branch off `main`. Web work only. No iOS file touched.
4. **RLS extension** for multi-user (W4) ships behind a feature flag — `WHERE profile_id = auth.uid()` continues to work for solo carriers (iOS users) until org_members is populated.
5. **Web Pro = Stripe** only. Never link to App Store IAP from web. Never grant iOS entitlement from a web Stripe subscription (Apple rule).
6. **Domain split.** Web lives at `app.sacredpathway.org`. Marketing stays at `sacredpathway.org`. iOS app's `Config.Web.dashboardURL` already points correctly.

### Phase plan

#### W2 — Paystub Generator + Write Parity (1–2 weeks)
Goal: a carrier can sit at a desktop, type or import load data, click "Generate Paystub", and email a branded PDF to a driver. Plus edit everything currently read-only.

Tasks:
1. Migration `20260520000000_paystub_line_items.sql` — new table + columns
2. Migration `20260520010000_drivers_hr_fields.sql` — driver address/CDL/HR
3. Server actions for CRUD: loads, expenses, drivers, brokers, broker_contacts (Next.js server actions with RLS-aware Supabase client)
4. New routes: `/drivers`, `/drivers/[id]`, `/drivers/new`, `/loads/new`, `/loads/[id]/edit`, `/expenses/new`
5. **Paystub Generator** at `/payroll/new`:
   - Pick driver → autofill name/address/pay split
   - Pick loads in period (multi-select) → autofill revenue/expenses
   - Add line items: deductions, reimbursements, advances, fuel adv, detention, bonuses
   - Live calc preview (port `SettlementEngine` to TS)
   - Generate → render HTML template (port from `SettlementHTMLPDFService`) → Puppeteer/`@sparticuz/chromium` on Edge → store PDF in `settlements` bucket → email link
6. New route `/payroll` — settlement history per driver, download/email/void
7. New route `/settings` — company info, pay-split defaults, paystub footer, logo upload
8. Stripe billing skeleton (no enforcement yet) — wire customer creation on signup

Schema commit:
```sql
-- supabase/migrations/20260520000000_paystub_line_items.sql
CREATE TABLE IF NOT EXISTS paystub_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id UUID REFERENCES settlements(id) ON DELETE CASCADE NOT NULL,
  profile_id    UUID REFERENCES profiles(id)    ON DELETE CASCADE NOT NULL,
  kind   TEXT NOT NULL CHECK (kind IN
    ('deduction','reimbursement','advance','bonus','detention','toll','fuel_advance','other')),
  label  TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  notes  TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_paystub_lines_settlement ON paystub_line_items(settlement_id);
ALTER TABLE paystub_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own line items" ON paystub_line_items
  FOR ALL USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());

ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS paystub_number   TEXT,
  ADD COLUMN IF NOT EXISTS paystub_pdf_url  TEXT,
  ADD COLUMN IF NOT EXISTS emailed_to       TEXT[],
  ADD COLUMN IF NOT EXISTS emailed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_method   TEXT,
  ADD COLUMN IF NOT EXISTS external_settlement_id TEXT;
```

#### W3 — Fleet, Recons, Documents Upload (2 weeks)
1. Migration: `trucks`, `trailers`, `recons`, `recon_load_links`, add FK columns to `loads`
2. Routes: `/fleet/trucks`, `/fleet/trailers`, `/recons`, `/recons/new`
3. Document upload from desktop: drag-drop to `/documents/upload` → Supabase Storage `documents/<profile_id>/...` → row in `documents` → trigger existing `extract-document` Edge Function
4. CSV import for loads (bulk paste from spreadsheets)
5. Reports: `/reports/payroll`, `/reports/revenue`, `/reports/expenses`, `/reports/cpa-export` — CSV + PDF download
6. Stripe enforcement: Free / Pro ($29.99/mo) / Carrier ($79.99/mo) — gate Drivers > 1, multi-truck, Reports export

#### W4 — Multi-user Carrier HQ (2–3 weeks)
1. Migration: `org_members`, `activity_log`
2. **RLS rewrite:** every table's `USING (profile_id = auth.uid())` becomes `USING (profile_id IN (SELECT profile_id FROM org_members WHERE user_id = auth.uid() AND active) OR profile_id = auth.uid())`. iOS users still work because their `profile_id = auth.uid()` always matches.
3. Invite UI: owner invites dispatcher/admin/accountant by email → Supabase magic link signup → row in `org_members`
4. Role-gated UI: dispatcher sees loads + brokers; accountant sees expenses + reports; admin sees everything except billing; owner sees billing
5. Activity log feed on dashboard
6. White-label option for dispatch services (custom subdomain + logo)

#### W5 — Polish & Monetize
- DAT/Truckstop rate-board integration
- QuickBooks export
- Push/email notifications for missing receipts, settlement reminders
- Seed deck for fundraise

### Pre-flight checklist before W2 starts
- [ ] Confirm `app.sacredpathway.org` DNS points to Cloudflare Pages `driver-hub-web` project
- [ ] Confirm Apple Services ID `com.demarquishinton.sacredpathway.web` exists with `https://app.sacredpathway.org/auth/callback` in return URLs
- [ ] Confirm Supabase Auth → URL Config has `https://app.sacredpathway.org` as Site URL + `/auth/callback` in Redirect URLs
- [ ] Run RLS verification queries (DRIVER_HUB_WEB_PLAN.md §2) — paste output
- [ ] Apple Developer account: Stripe page ready for web-Pro (no IAP linkage)
- [ ] Stripe account exists — needs SP_Trucking LLC EIN
- [ ] Create `feature/carrier-hq` branch off `main`

---

## 6. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| RLS change in W4 breaks iOS reads | Medium | Critical | Test policy in staging first; iOS query shape `where profile_id = auth.uid()` is preserved |
| Apple review flags web subscription | Low | Medium | Never link to Stripe from inside iOS app; web Pro lives entirely outside |
| Schema migration runs partial in prod | Low | High | Every migration `IF NOT EXISTS` / `IF NOT EXISTS` idempotent; rehearse on `staging` Supabase project (clone via `supabase db dump` → import) |
| Edge runtime can't render PDFs server-side | Medium | Medium | Fallback to Node runtime route for paystub PDF gen (`@react-pdf/renderer` is Node-only; Edge Chromium via `@sparticuz/chromium` works but is fragile) |
| iOS user signs in on web → no data shown | High | Low | Already handled: same `auth.users` row, same `profile_id`, RLS lines up |
| Carrier with 2 users sees billing twice | Medium | Low | Owner-only billing route in W4 |

---

## 7. Recommendation

**Start Phase W2 now.** The foundation is done — read-only Carrier HQ already deploys to Cloudflare. The next ship is the **Paystub Generator** because:
1. It's the one feature carriers will pay for on day one
2. It unblocks the "Carrier HQ command center" pitch
3. It exercises the full write-path (auth → server action → RLS-secured insert → PDF gen → email)
4. It does NOT touch iOS

**Estimate:** 5–8 working days for a polished W2 release, including Stripe checkout skeleton.

**What I need from you to start coding:**
1. Greenlight on `feature/carrier-hq` branch + the W2 scope above
2. RLS audit output (run the two queries in `DRIVER_HUB_WEB_PLAN.md` §2)
3. Apple Services ID confirmation + Supabase Auth URL config check
4. Stripe publishable key (test mode is fine to start)

Reply "go" and I'll start W2 with the migration + server actions + paystub generator route.
