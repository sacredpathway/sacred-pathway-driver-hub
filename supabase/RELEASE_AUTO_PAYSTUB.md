# Automatic document → paystub — release checklist (single source of truth)

Branch `feature/auto-paystub` (contains `release/web-settlements`, H1 `827b224`, `feature/smart-payroll-upload`).
Updated 2026-10-25. Never use `supabase db push`. 🔒 = needs explicit owner approval.
Each step lists **Do**, **Verify (gate — stop if any check fails)** and **Rollback**. Steps are in dependency order;
a step may start only when every earlier gate passed.

## Starting state (verified read-only 2026-10-25)
- Production: PostgreSQL 17.6 · 43 migrations = repo (history check 43 × ok) · #4, #5 absent · Edge `extract-document`
  v21 (= commit `3638672`, byte-identical) · Worker version `1c006674…` (H1, build `GT7sD7I327NmOSgqdJSXd`, no payroll
  code) · 0 settlements · 0 v3 documents · settlement functions md5 `1ef1bb1ede2ee9a82661a20913c6f660`.
  → **Automation is impossible in production today** (no code, no functions, no v3 extractor).
- Staging `aatkirzwuuegurdlmcpl`: PostgreSQL 17.6 · #4 and #5 applied (#5 = `20261025174009`) · no Edge Functions ·
  `documents` bucket private with own-folder policies · same settlement md5.
- Tests: web 774 · e2e 16/16 + race/rollback · DB suites on PG 17.6 (133/14/67/9/29/153) · Deno fmt/lint/check ·
  `next build` + OpenNext build · **staging browser 18/18 on the final code** · **hosted race on staging: 10 concurrent
  creates → 1 load (×2), other carrier separate, anon 401**.

## Kill switches (Worker vars; changing one needs no code build)
| Var | Effect |
|---|---|
| `SMART_PAYROLL_CONFIRM` unset | All payroll writes from documents OFF (manual + automatic). Default. |
| `SMART_PAYROLL_AUTO=off` | Automatic drafting OFF; manual "Confirm to draft" still allowed. |
| `SMART_LOAD_AUTO_CREATE=off` | Automatic load creation OFF. |
| `DOCUMENT_EXTRACTION_VERSION` unset/`v2` | No v3 (payroll) extraction requests. |

ON requires **both** `SMART_PAYROLL_CONFIRM=production` and `SMART_PAYROLL_PRODUCTION_ACK=rmzqxsfhjqrshhdjzhze` with
the exact production URL. Nothing in the code can approve or pay a settlement.

## iPhone 2.3.6 requirements (apply to every step)
| # | Requirement | How this release meets it | Checked in |
|---|---|---|---|
| I1 | Scans with no `extraction_version` behave exactly as today | v22 v1 path byte-identical to v21; imports no changed shared code | Step 5 gate |
| I2 | iPhone can decode every document row | v3 `extracted_data` shares only `document_type`, `notes` (strings) with `ExtractedData` (all optional) | Steps 2, 6 |
| I3 | Automation-written settlement lines decode | categories `fuel`/`tolls`/`repair`/`scale_tickets`, `responsibility`, `document_id` all in 2.3.6 models | Step 7 |
| I4 | Auto-created loads look like existing ones | `status` default `pending` (String in 2.3.6; all 164 prod loads already pending) | Step 8 |
| I5 | iPhone uploads never hit #4's unique index | 2.3.6 never writes `content_sha256` | Step 3 |
| I6 | iPhone load delete still works | #4 claims FK = `on delete set null`; R1 retention test passes on PG 17.6 | Step 3 |
| I7 | Known, accepted behaviour | iPhone edit of a document that sits on an approved/paid/voided settlement (load/settlement fields) is refused by #4's guard with "Reopen the settlement first". Today 0 such documents. | Step 3 |
| I8 | Not shipped here | `migrations_pending/…lock_finalized_settlements.sql` breaks 2.3.6 edits → only after 2.3.7 is the minimum version | — |

Static source review of the 2.3.6 snapshot (MARKETING_VERSION 2.3.6) + DB tests. **Not run on a device/simulator** —
each step's iPhone smoke check is the device verification.

---

## Step 1 🔒 — Rotate exposed credentials (before anything else)
**Do:** follow `supabase/SECURITY_CREDENTIAL_ROTATION.md` (F1 `+appreview` public on GitHub; F2 dispatch demo
accounts; F3 leaked-password protection). Uses `scripts/rotate_review_credentials.sh` (hidden prompts only).
**Verify:** the SQL in that file: `updated_at` after rotation (or `banned_until` set) for all three, sessions 0; App Store
Connect review sign-in updated if it uses a rotated account; dashboard shows leaked-password protection ON.
**Rollback:** rotate again / `… enable <id>`.

## Step 2 🔒 — Push, PR, CI
**Do:**
```bash
cd ~/Developer/sacred-pathway-driver-hub
git fetch origin && git merge-base --is-ancestor origin/feature/auto-paystub feature/auto-paystub && echo FF-OK
git push origin feature/auto-paystub          # fast-forward from 325390b
```
Open PR → `main`. (Optional: make the repo private — see the security doc; does not affect App Store legal URLs.)
**Verify:** `FF-OK` printed; CI green (web-ci: tsc/eslint/vitest/build; ci: deno fmt/lint/check, `bash -n scripts/*.sh`).
**Rollback:** none needed (nothing deployed). Merge to `main` after Step 3–4 review, or keep the branch.

## Step 3 🔒 — Production web deploy, automation OFF
**Preflight (read-only, I can run):** history 43 × ok; settlement md5 = `1ef1bb1e…`; 0 settlements.
**Do (Mac):** Worker vars `SMART_PAYROLL_CONFIRM`, `SMART_PAYROLL_PRODUCTION_ACK`, `DOCUMENT_EXTRACTION_VERSION` **unset**.
```bash
cd ~/Developer/sacred-pathway-driver-hub && git checkout feature/auto-paystub
cd web-app && npm ci && npx vitest run && npx tsc --noEmit        # expect 774 passed, 0 errors
npx wrangler deployments list --name driver-hub-web-worker         # record current id (expect 1c006674…)
npm run cf:deploy                                                   # Next 16.4.3 / OpenNext 1.20.13 — no unsupported flag
npx wrangler deployments list --name driver-hub-web-worker         # new id @ 100%
```
**Verify:** `/` and `/auth/signin` 200 with a new build id; signed-in smoke of dashboard, loads, documents, payroll,
settlements, drivers, expenses, reports (200, no console errors); Documents shows the "turned off" payroll message;
upload one synthetic PDF → filed/review, **no settlement created** (count stays 0); `wrangler tail` 10 min → 0
exceptions; settlement md5 unchanged. **iPhone 2.3.6 (I2):** sign in, open Document Vault, scan one test doc → OK.
**Rollback:** `npx wrangler rollback 1c006674-71fa-4107-8452-6ac49a792d4a --name driver-hub-web-worker`.

## Step 4 🔒 — Production migration #4 (Smart Payroll claims)
**Preflight:** duplicate live sha groups = 0 (query in `MIGRATION_VERSION_MAP.md` §Check / runbook history).
**Do:** apply `supabase/migrations_proposed/PROPOSED_20261105120000_smart_payroll_upload.sql` (sha256 `e2b9ffb5…`) once,
via MCP `apply_migration` name `smart_payroll_upload`. Commit the rename to `supabase/migrations/<recorded>_smart_payroll_upload.sql`
and add the version to `supabase/tests/migration_history_check.sql`.
**Verify:** 4 new nullable `documents` columns; `documents_profile_sha256_live_uidx`; `document_payroll_claims` + 4
`sph_payroll_claim*` functions; anon has no access; settlement md5 unchanged; history check 44 × ok.
**iPhone 2.3.6 (I5, I6):** scan + save a document; delete a test load that has a document.
**Rollback:** `ROLLBACK_PROPOSED_20261105120000_smart_payroll_upload.sql` (archives claims; tested on PG 16 + 17.6).
The web keeps working without #4.

## Step 5 🔒 — Production migration #5 (guarded automatic load creation)
**Do:** apply `PROPOSED_20261106120000_auto_create_load.sql` (sha256 `921a4a87…`), name `auto_create_load`; commit the rename.
**Verify:**
```sql
select md5(pg_get_functiondef(p.oid)), p.prosecdef,
       has_function_privilege('anon','public.sph_load_create_verified(jsonb)','execute'),
       has_function_privilege('authenticated','public.sph_load_create_verified(jsonb)','execute')
  from pg_proc p where p.proname = 'sph_load_create_verified';
-- expect 2dc845b944044ccb1cbb9638ec20da5d, false, false, true  (same as staging)
```
**Rollback:** `ROLLBACK_PROPOSED_20261106120000_auto_create_load.sql`. Without #5 the app creates no loads automatically.

## Step 6 🔒 — Edge Function v22: staging (no key = no cost), then production
Package + checksums: `supabase/deploy/extract-document-v22/`.
**6a Staging, no OpenAI key (zero cost):** `supabase functions deploy extract-document --project-ref aatkirzwuuegurdlmcpl --no-verify-jwt`
(after `shasum -a 256 -c MANIFEST.v22.sha256`). Verify with a synthetic staging account: OPTIONS 200; no JWT → 401
`AUTH_EXPIRED`; random UUID → `UNKNOWN_SCAN_ERROR` (stage `row_lookup`); other account's document → `AUTH_EXPIRED`
(stage `profile_mismatch`), no row change; own synthetic document → `OPENAI_API_KEY not set` and the row marked failed
(proves auth, ownership and storage download all work up to the model step, no charge).
**6b Production deploy:** same command with `--project-ref rmzqxsfhjqrshhdjzhze`; production already has `OPENAI_API_KEY`.
**Verify (I1):** iPhone 2.3.6 scans one document → same result screen as before; row `extraction_version` is null (v1 path).
**Rollback:** redeploy `3638672`'s files (`MANIFEST.v21-rollback.sha256`, verified identical to live v21).

## Step 7 🔒 — Live AI extraction test (incurs OpenAI charges), automation still OFF
**Do:** staging first if a staging key is added (`supabase secrets set --project-ref aatkirzwuuegurdlmcpl OPENAI_API_KEY=…`),
otherwise production with Worker var `DOCUMENT_EXTRACTION_VERSION=v3` and confirm gate still unset. Upload 5 owner
documents: rate con (existing load), rate con (new load), POD, fuel receipt, lumper receipt.
**Verify:** each row `extraction_version='v3'`; every amount the owner checks against the paper is exact; `source_text`
quotes the paper; correct `document_type`; no settlement and no load created. **iPhone (I2):** those documents open in the
Document Vault (fields may be blank). Any wrong amount → STOP, set `DOCUMENT_EXTRACTION_VERSION` back to unset.
**Rollback:** unset `DOCUMENT_EXTRACTION_VERSION`.

## Step 8 🔒 — Enable automatic drafting (loads still manual)
**Do:** Worker vars `SMART_PAYROLL_CONFIRM=production`, `SMART_PAYROLL_PRODUCTION_ACK=rmzqxsfhjqrshhdjzhze`,
`SMART_LOAD_AUTO_CREATE=off`. Pilot on the owner's account for one pay week.
**Verify:** each delivered rate con on an existing load → one settlement in status `draft` (never approved/paid); net = the
driver's stored pay rule × revenue, to the cent; receipts become driver deductions only where the driver's terms make them
the driver's; lumper never added; undelivered loads held ("not delivered yet"); held items show reasons.
**iPhone (I3):** open the draft settlement on 2.3.6 → lines and deductions display.
**Rollback:** `SMART_PAYROLL_AUTO=off` (drafting) or unset `SMART_PAYROLL_CONFIRM` (everything). Drafts stay editable/deletable.

## Step 9 🔒 — Enable automatic load creation
**Do:** unset `SMART_LOAD_AUTO_CREATE`.
**Verify:** a verified rate con for a new load → exactly one load (status `pending`) with the printed driver; the duplicate-load
monitoring query stays at 2 groups. **iPhone (I4):** the new load appears and opens.
**Rollback:** `SMART_LOAD_AUTO_CREATE=off`.

## Monitoring (read-only, daily during the pilot — I can run these)
```sql
-- duplicate load numbers per carrier (2 pre-existing groups on 2026-10-25; must not grow)
select count(*) from (select profile_id, upper(regexp_replace(coalesce(load_number,''),'[^A-Za-z0-9]','','g')) k
  from public.loads group by 1,2 having count(*) > 1 and length(upper(regexp_replace(coalesce(load_number,''),'[^A-Za-z0-9]','','g'))) >= 3) x;
-- automatic outcomes in the last day
select routing->'autopay'->>'state' state, count(*) from public.documents
 where updated_at > now() - interval '1 day' and routing ? 'autopay' group by 1;
-- stale pending claims (should be 0)
select count(*) from public.document_payroll_claims where status = 'pending' and expires_at < now();
-- nothing approved/paid without a person: list approved/paid settlements and who transitioned them
```
