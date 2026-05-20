# Carrier HQ — Dual-Mode Payroll Schema (W2 + 1099)
Sacred Pathway Driver Hub · Phase W2 (revised) · 2026-05-20
**Status: design proposal — no migrations written yet. Confirm before implementation.**

---

## Design principles

1. **Additive only.** Existing `settlements` table stays untouched; iOS continues to read it as-is. New `paystubs` table is the unified parent record going forward; legacy iOS settlements remain functional.
2. **Normalized, not column-bloated.** Earnings, deductions, taxes, and 1099 settlement items live in their own child tables. The parent paystub row holds only totals + metadata. This is the only way W2 tax reports and 1099-NEC year-end exports stay clean later.
3. **YTD snapshots per row.** Each child row records its own `ytd_amount` at the time of issuance. Past paystubs are immutable — no rolling sums computed at read time.
4. **Worker-type-driven, not table-split.** One `paystubs` table for both W2 and 1099. The `worker_type` column drives which child tables get rows and which UI fields render. Mixed-fleet carriers (some W2 employees + some 1099 owner-operators) need one query for "all payroll this period."
5. **Tax placeholders, not tax engines.** W2 withholding amounts are entered manually or stubbed. No `compute_federal_withholding()` function. No IRS tables. Architecture is ready for that engine later — schema doesn't need to change when it lands.

---

## 1. Driver classification

### Extend existing `drivers` table — ADDITIVE COLUMNS

```text
drivers
  + worker_type              TEXT NOT NULL DEFAULT '1099'
                             CHECK (worker_type IN ('1099','W2'))
  -- 1099 fields (already partly there: pay_type, pay_percentage, flat_rate)
  + escrow_per_settlement    NUMERIC(10,2)        -- auto-deduct from each 1099 settlement
  + escrow_balance           NUMERIC(10,2) DEFAULT 0
  -- W2 employee fields
  + employment_status        TEXT                 -- 'active','on_leave','terminated'
  + pay_frequency            TEXT                 -- 'weekly','biweekly','semimonthly','monthly'
  + comp_type                TEXT                 -- 'hourly','salary','mileage','per_load'
  + hourly_rate              NUMERIC(10,2)
  + salary_annual            NUMERIC(12,2)
  + mileage_rate             NUMERIC(10,4)        -- per-mile pay
  + per_load_rate            NUMERIC(10,2)
  + per_diem_daily           NUMERIC(10,2)
  + overtime_multiplier      NUMERIC(4,2) DEFAULT 1.5
  -- HR / tax setup (placeholders — no compute yet)
  + filing_status            TEXT                 -- 'single','married','married_separate','head_of_household'
  + federal_allowances       INTEGER              -- pre-2020 W-4 (kept for legacy)
  + w4_extra_withholding     NUMERIC(10,2)
  + state_code               TEXT                 -- 'TX', 'CA', etc.
  + state_allowances         INTEGER
  + ssn_encrypted            TEXT                 -- placeholder; encrypt at app layer
  + ein                      TEXT                 -- for 1099 corporate contractors
  + hire_date                DATE
  + termination_date         DATE
  + dob                      DATE
  + address                  TEXT
  + city                     TEXT
  + state                    TEXT
  + zip                      TEXT
  + emergency_contact_name   TEXT
  + emergency_contact_phone  TEXT
  + cdl_number               TEXT
  + cdl_state                TEXT
  + cdl_expiration           DATE
```

Why default `'1099'`? Every existing iOS-created driver row stays valid without touching iOS code or running a backfill. New W2 drivers are created through the web only.

---

## 2. Unified paystub parent — NEW TABLE

```text
paystubs
  id                     UUID PK
  profile_id             UUID FK → profiles  NOT NULL
  driver_id              UUID FK → drivers   NOT NULL
  worker_type            TEXT NOT NULL CHECK (worker_type IN ('1099','W2'))   -- snapshot
  paystub_number         TEXT                                                  -- 'PS-2026-00041'
  pay_period_start       DATE NOT NULL
  pay_period_end         DATE NOT NULL
  check_date             DATE                                                  -- issued/paid date
  status                 TEXT NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','issued','paid','voided'))
  payment_method         TEXT                  -- 'ach','zelle','cash','check','direct_deposit'
  check_number           TEXT
  -- Totals (computed in app, stored here for fast queries + immutability)
  gross_earnings         NUMERIC(12,2) DEFAULT 0   -- W2: sum of earnings; 1099: gross settlement
  total_pretax_deductions   NUMERIC(12,2) DEFAULT 0
  taxable_wages          NUMERIC(12,2) DEFAULT 0   -- W2 only; null for 1099
  total_taxes_withheld   NUMERIC(12,2) DEFAULT 0   -- W2 only; null for 1099
  total_posttax_deductions  NUMERIC(12,2) DEFAULT 0
  total_reimbursements   NUMERIC(12,2) DEFAULT 0   -- non-taxable add-backs
  total_settlement_deductions NUMERIC(12,2) DEFAULT 0   -- 1099 only
  net_pay                NUMERIC(12,2) NOT NULL    -- final amount paid
  -- YTD snapshots at issuance — denormalized for the printed paystub
  ytd_gross_earnings     NUMERIC(12,2) DEFAULT 0
  ytd_taxable_wages      NUMERIC(12,2) DEFAULT 0
  ytd_taxes_withheld     NUMERIC(12,2) DEFAULT 0
  ytd_net_pay            NUMERIC(12,2) DEFAULT 0
  -- Metadata
  notes                  TEXT
  pdf_storage_path       TEXT
  emailed_to             TEXT[]
  emailed_at             TIMESTAMPTZ
  created_by_user_id     UUID FK → auth.users          -- for multi-user W4
  created_at             TIMESTAMPTZ DEFAULT NOW()
  updated_at             TIMESTAMPTZ DEFAULT NOW()
```

RLS: `profile_id = auth.uid()`. Index on `(profile_id, check_date DESC)` and `(driver_id, check_date DESC)`.

---

## 3. Child tables (the normalization)

### 3a. `paystub_earnings` — W2 earnings & 1099 gross lines

```text
paystub_earnings
  id              UUID PK
  paystub_id      UUID FK → paystubs  NOT NULL
  profile_id      UUID FK → profiles  NOT NULL                -- for RLS
  kind            TEXT NOT NULL CHECK (kind IN (
                   'regular','overtime','doubletime','holiday',
                   'sick','vacation','bonus','commission',
                   'per_diem','mileage','per_load',
                   'settlement_gross',          -- 1099: total load revenue or flat
                   'detention','layover','accessorial','other'
                 ))
  label           TEXT NOT NULL                   -- 'Regular hours', 'OT', 'TX→CA Load #281', etc.
  hours           NUMERIC(8,2)                    -- nullable; for hourly rows
  units           NUMERIC(10,2)                   -- nullable; miles, loads, days
  rate            NUMERIC(10,4)                   -- per hour/mile/load/day
  amount          NUMERIC(12,2) NOT NULL
  is_taxable      BOOLEAN NOT NULL DEFAULT TRUE   -- per diem within IRS rate = false
  load_id         UUID FK → loads                 -- optional link
  ytd_amount      NUMERIC(12,2) DEFAULT 0         -- snapshot at issuance
  notes           TEXT
  created_at      TIMESTAMPTZ DEFAULT NOW()
```

W2 use: many rows per paystub — regular, OT, per diem, bonus.
1099 use: typically one or many `settlement_gross` rows (one per load) or a single flat row.

### 3b. `paystub_deductions` — pre-tax and post-tax (both worker types use this for things like garnishments, advances)

```text
paystub_deductions
  id              UUID PK
  paystub_id      UUID FK → paystubs  NOT NULL
  profile_id      UUID FK → profiles  NOT NULL
  kind            TEXT NOT NULL CHECK (kind IN (
                   -- W2 pre-tax
                   '401k','401k_roth','health_premium','dental_premium','vision_premium',
                   'hsa','fsa','commuter','life_insurance','disability',
                   -- W2 post-tax
                   'garnishment','child_support','union_dues','loan_repayment','uniform',
                   -- both
                   'advance_repayment','other'
                 ))
  label           TEXT NOT NULL
  amount          NUMERIC(12,2) NOT NULL          -- positive number; sign handled in totals
  is_pre_tax      BOOLEAN NOT NULL DEFAULT FALSE
  ytd_amount      NUMERIC(12,2) DEFAULT 0
  notes           TEXT
  created_at      TIMESTAMPTZ DEFAULT NOW()
```

### 3c. `paystub_taxes` — W2 only (table exists for 1099 rows but is left empty)

```text
paystub_taxes
  id              UUID PK
  paystub_id      UUID FK → paystubs  NOT NULL
  profile_id      UUID FK → profiles  NOT NULL
  kind            TEXT NOT NULL CHECK (kind IN (
                   'federal_income','state_income','local_income',
                   'social_security','medicare','medicare_additional',
                   'sui','sdi','futa','suta','workers_comp','other'
                 ))
  jurisdiction    TEXT                             -- 'US','TX','CA','NYC'
  label           TEXT NOT NULL                    -- 'Federal Income Tax', 'TX SUI'
  employee_amount NUMERIC(12,2) NOT NULL DEFAULT 0 -- withheld from check
  employer_amount NUMERIC(12,2) NOT NULL DEFAULT 0 -- employer-side match (SS, Medicare, FUTA, SUTA, WC)
  ytd_employee_amount NUMERIC(12,2) DEFAULT 0
  ytd_employer_amount NUMERIC(12,2) DEFAULT 0
  rate_basis      TEXT                             -- 'manual','flat_percent','table_lookup' (future)
  notes           TEXT
  created_at      TIMESTAMPTZ DEFAULT NOW()
```

Separating `employee_amount` and `employer_amount` here is what unlocks future quarterly 941 reports and W-2 box totals without another schema change.

### 3d. `paystub_settlement_items` — 1099 only (deductions/escrow/chargebacks)

```text
paystub_settlement_items
  id              UUID PK
  paystub_id      UUID FK → paystubs  NOT NULL
  profile_id      UUID FK → profiles  NOT NULL
  kind            TEXT NOT NULL CHECK (kind IN (
                   'escrow_deposit','escrow_release',
                   'advance','advance_repayment',
                   'fuel_advance','fuel_deduction',
                   'toll','maintenance','tire','permit',
                   'eld_lease','truck_lease','trailer_lease','plate',
                   'insurance','occupational_accident','cargo_insurance',
                   'chargeback','damage','claim',
                   'factoring_fee','dispatcher_fee','authority_fee','maintenance_reserve',
                   'reimbursement','bonus','detention_pay','layover_pay',
                   'other'
                 ))
  label           TEXT NOT NULL
  amount          NUMERIC(12,2) NOT NULL           -- positive number
  direction       TEXT NOT NULL                    -- 'deduct' or 'add'
                  CHECK (direction IN ('deduct','add'))
  load_id         UUID FK → loads                  -- optional link to specific load
  ytd_amount      NUMERIC(12,2) DEFAULT 0
  notes           TEXT
  created_at      TIMESTAMPTZ DEFAULT NOW()
```

This is the table that maps to a classic 1099 settlement sheet line by line. `direction = 'deduct'` for fuel/escrow/chargeback; `direction = 'add'` for reimbursement/bonus/detention.

---

## 4. Math contract (what the app enforces, NOT the DB)

```text
W2 paystub:
  gross_earnings              = SUM(paystub_earnings.amount)
  total_pretax_deductions     = SUM(paystub_deductions WHERE is_pre_tax = TRUE)
  taxable_wages               = gross_earnings - total_pretax_deductions
                                - SUM(earnings.amount WHERE is_taxable = FALSE)
  total_taxes_withheld        = SUM(paystub_taxes.employee_amount)
  total_posttax_deductions    = SUM(paystub_deductions WHERE is_pre_tax = FALSE)
  net_pay                     = gross_earnings
                                - total_pretax_deductions
                                - total_taxes_withheld
                                - total_posttax_deductions

1099 paystub (settlement):
  gross_earnings              = SUM(paystub_earnings.amount)
  total_settlement_deductions = SUM(settlement_items WHERE direction = 'deduct')
  total_reimbursements        = SUM(settlement_items WHERE direction = 'add')
  total_posttax_deductions    = SUM(paystub_deductions)   -- rare on 1099 but allowed
  taxable_wages               = NULL
  total_taxes_withheld        = 0                          -- no withholding
  net_pay                     = gross_earnings
                                + total_reimbursements
                                - total_settlement_deductions
                                - total_posttax_deductions
```

Both formulas resolve to `net_pay = sum of credits - sum of debits`. The same paystub view component renders either layout based on `worker_type`.

---

## 5. Legacy `settlements` table — what we do with it

**Keep it.** Don't migrate iOS data; don't touch the table shape. The iOS app continues to write to it.

Add ONE column for forward-compatibility:

```text
settlements
  + paystub_id  UUID FK → paystubs   -- nullable; set if/when a web-generated paystub
                                        replaces or supersedes this legacy settlement
```

Reports query both tables via a UNION view (`v_payroll_unified`) for analytics. The web app only writes to `paystubs`. The iOS app only writes to `settlements`. They coexist.

---

## 6. Supporting tables (defer if needed)

### `pay_periods` — OPTIONAL, Phase W3
Pre-defined pay-period calendar for W2 employees. Lets the carrier click "Run payroll for period 2026-05-12 → 2026-05-18" once and generate paystubs for all active W2 drivers in one shot.

```text
pay_periods
  id, profile_id, period_start, period_end, check_date, frequency, status
```

Skip for W2 first ship — generate paystubs one driver at a time. Add when carrier asks.

### `driver_compensation_history` — DEFER
Tracks rate changes over time. Not needed for v1 — current rate on `drivers` row is the source of truth. Add when an auditor asks.

### `tax_jurisdictions` — DEFER
Lookup table for state/local tax codes. Hard-code dropdown values in the UI for v1.

---

## 7. UI behavior driven by `worker_type`

### Driver detail page
- Top of form: **Worker Type** toggle: `1099 Contractor` | `W2 Employee`
- Switching reveals/hides the relevant block; never deletes data already entered

**1099 block** (current behavior): pay_type (percent/flat), pay_percentage, flat_rate, escrow_per_settlement
**W2 block** (new): comp_type, hourly/salary/mileage/per-load rates, per_diem_daily, overtime_multiplier, pay_frequency, filing_status, allowances, state_code, W-4 extra

### Payroll generator page (new)
URL: `/payroll/new?driver_id=…`

Page title and form change by driver's `worker_type`:

**If `worker_type = 'W2'` → "Employee Payroll"**
- Section 1: Earnings (add row per kind — regular hrs × rate, OT hrs × rate, per diem days × rate, bonus, reimbursement)
- Section 2: Pre-Tax Deductions (401k, health, etc.)
- Section 3: Taxes (federal, state, SS, Medicare — all manual entry with helper hints)
- Section 4: Post-Tax Deductions (garnishments, advances)
- Sidebar: live Net Pay calc + YTD snapshot

**If `worker_type = '1099'` → "Contractor Settlement"**
- Section 1: Loads in Period (multi-select; pulls gross from loads)
- Section 2: Deductions (escrow, fuel, tolls, maintenance, chargebacks, factoring, dispatcher fee)
- Section 3: Add-backs (reimbursements, bonuses, detention)
- Sidebar: live Net Settlement calc + escrow balance running total

### Paystub PDF (one template, two layouts)
Same template engine; layout branches on `worker_type`:

**W2 layout:**
```
EMPLOYEE PAYSTUB                                Period: 5/12 – 5/18
[Company]                                       Check Date: 5/20
[Employee: Name, Address, SSN ****1234]
EARNINGS         HOURS   RATE      THIS PERIOD   YTD
Regular          40.00   25.00     1,000.00      18,400.00
Overtime          5.50   37.50       206.25       3,090.50
...
PRE-TAX DEDUCTIONS                THIS PERIOD   YTD
401(k)                              50.00          750.00
TAXES                              THIS PERIOD   YTD
Federal Income Tax                 120.45        1,981.00
Social Security                     74.40        1,116.00
Medicare                            17.41          261.00
TX State Income                      0.00            0.00
POST-TAX DEDUCTIONS               THIS PERIOD   YTD
Child Support                       80.00        1,200.00
                                  GROSS    1,206.25
                              TOTAL TAX     -212.26
                            DEDUCTIONS     -130.00
                                NET PAY      863.99
```

**1099 layout:**
```
CONTRACTOR SETTLEMENT                           Period: 5/12 – 5/18
[Company]                                       Settlement Date: 5/20
[Contractor: Name, Address, EIN/SSN]
LOADS                                          AMOUNT
Load #2841  Dallas → Phoenix    1,420 mi      3,200.00
Load #2842  Phoenix → LA          385 mi        950.00
                          Gross Settlement    4,150.00
DEDUCTIONS                                      AMOUNT
Fuel Advance                                     -680.00
Escrow Deposit                                   -100.00
Factoring Fee (3%)                              -124.50
Chargeback — Load #2841 lumper                   -75.00
                         Total Deductions      -979.50
ADD-BACKS                                       AMOUNT
Detention — Load #2841 (3 hrs)                  +150.00
                            Total Add-Backs    +150.00
                                Net Payout    3,320.50
                                                ─────
                                  Escrow Balance: $1,400.00
                                            YTD Gross: $87,420.00
```

---

## 8. Future tax reports — what this schema unlocks (no further migrations)

| Future report | Query shape |
|---|---|
| **Form 941 (quarterly federal payroll tax)** | `SELECT SUM(employee_amount), SUM(employer_amount) FROM paystub_taxes WHERE profile_id = … AND kind IN ('federal_income','social_security','medicare','medicare_additional') AND check_date BETWEEN q_start AND q_end` |
| **State quarterly (SUI/SDI/SUTA)** | same shape, filter `kind` + `jurisdiction` |
| **W-2 box 1 (taxable wages)** | `SUM(taxable_wages) WHERE driver_id = … AND check_date BETWEEN year_start AND year_end` |
| **W-2 boxes 3/5 (SS/Medicare wages)** | derived from earnings minus pre-tax-non-SS deductions; the data is all there |
| **1099-NEC box 1 (nonemployee compensation)** | `SUM(gross_earnings) FROM paystubs WHERE worker_type='1099' AND driver_id=… AND check_date BETWEEN year_start AND year_end` |
| **Driver YTD on-demand** | already snapshotted on every paystub row |

No new columns will be needed for any of the above.

---

## 9. RLS policies (all 5 new tables)

```text
ALTER TABLE paystubs                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE paystub_earnings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE paystub_deductions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE paystub_taxes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE paystub_settlement_items   ENABLE ROW LEVEL SECURITY;

-- Identical shape on each table:
CREATE POLICY "own paystubs" ON paystubs
  FOR ALL USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());
-- (and same on each child)
```

In Phase W4 every policy gets the `OR profile_id IN (SELECT … FROM org_members …)` extension — same drop-in pattern as the rest of the schema.

---

## 10. Migration files (additive only — no destructive ops)

1. `20260521000000_drivers_dual_worker_type.sql` — extend `drivers` (worker_type, escrow, W2 fields, HR fields)
2. `20260521010000_paystubs_unified.sql` — create `paystubs` + all 4 child tables + indexes + RLS
3. `20260521020000_settlements_link_paystub.sql` — add `settlements.paystub_id` nullable FK
4. `20260521030000_payroll_unified_view.sql` — `v_payroll_unified` SQL view UNIONing legacy `settlements` and new `paystubs`

Every file uses `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE POLICY DROP-AND-RECREATE`. Idempotent. Re-runnable.

---

## 11. Implementation order for Phase W2 (revised)

1. **Migrations** (1–2 hr) — ship the 4 files above to Supabase
2. **TypeScript types** in `web-app/lib/supabase/types.ts` — `Paystub`, `PaystubEarning`, `PaystubDeduction`, `PaystubTax`, `PaystubSettlementItem`, extended `Driver`
3. **Server actions** (1 day) — CRUD for paystubs + children, with worker-type branching
4. **`SettlementEngine` port** (½ day) — TypeScript dual-mode calculator
5. **Drivers UI** (1 day) — worker_type toggle, dynamic field reveal, all new columns
6. **Payroll Generator UI** (2–3 days) — `/payroll/new`, two layouts, live calc sidebar, multi-load picker for 1099
7. **PDF service** (1–2 days) — single HTML template, two layouts, Puppeteer on Edge or Node route
8. **Payroll history** (½ day) — `/payroll` list view, filters by driver / period / status
9. **Settings** (½ day) — pay-split defaults, paystub footer/legal text, company logo upload
10. **QA pass + smoke test** (1 day) — generate one of each (1099 + W2), download PDFs, verify YTD math, verify iOS app still reads existing settlements without error

Total: **8–10 working days** for full dual-mode Carrier HQ payroll, no Stripe yet, no iOS touch.

---

## 12. Safety checklist (unchanged from prior plan)

- [x] All migrations additive — no `DROP`, no `RENAME`, no `NOT NULL` tightening on existing columns
- [x] iOS settlements table & RLS untouched
- [x] New branch `feature/carrier-hq` only
- [x] No Stripe code in this phase
- [x] No iOS file modified
- [x] v2.1.0 build 30 stays in Apple review queue undisturbed

---

## Confirm before I build

Reply with one of:

- **"go"** — I'll write all 4 migrations + TS types + Drivers UI worker_type toggle as the first commit, then proceed through steps 3–10.
- **"change X"** — point at any section above to revise.
- **"add Y"** — additions to schema before the first migration.

Once you confirm, the first commit will be migrations + types only — zero UI changes — so you can review the schema in Supabase before any frontend lands.
