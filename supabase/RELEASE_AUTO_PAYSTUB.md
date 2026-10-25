# Automatic document → paystub: production release sequence

Branch `feature/auto-paystub` (contains `release/web-settlements`, the H1 hotfix and
`feature/smart-payroll-upload`). Prepared 2026-10-25. **Nothing here has been run against
production.** Every step marked 🔒 needs explicit owner approval. Never use `supabase db push`.

Production today (read-only, 2026-10-25): PostgreSQL 17.6; 43 migrations, all matching this repo
(`supabase/tests/migration_history_check.sql` → 43 × ok); Edge `extract-document` v21 (= commit
`3638672`); #4 and #5 not applied; 174 documents (1 with a sha256, 0 duplicate sha groups, 0 on a
settlement); 164 loads (2 pre-existing duplicate load-number groups, all pending, none on a settlement).

## Kill switches (Worker vars, no deploy needed)

| Var | Effect |
|---|---|
| `SMART_PAYROLL_CONFIRM` unset | All payroll writes from documents OFF (manual and automatic). Default. |
| `SMART_PAYROLL_AUTO=off` | Automatic drafting OFF; manual confirm still allowed. |
| `SMART_LOAD_AUTO_CREATE=off` | Automatic load creation OFF; everything else unchanged. |
| `DOCUMENT_EXTRACTION_VERSION` unset/`v2` | No v3 (payroll) extraction requests. |

Production ON requires **both** `SMART_PAYROLL_CONFIRM=production` and
`SMART_PAYROLL_PRODUCTION_ACK=rmzqxsfhjqrshhdjzhze`, and the exact production URL. Nothing can approve
or pay a settlement.

## Sequence

### 0. Preflight (read-only)
Run in the production SQL editor; all must hold:
```sql
-- a) history: 43 rows, all 'ok'
-- paste supabase/tests/migration_history_check.sql
-- b) #4 unique index precondition: must be 0
select count(*) from (select profile_id, content_sha256 from public.documents
  where content_sha256 is not null and duplicate_of is null and review_status is distinct from 'dismissed'
  group by 1,2 having count(*) > 1) x;
-- c) settlement write functions unchanged (record the value; re-check after each step)
select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.proname)) from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('sph_web_save_settlement','sph_web_transition_settlement');
```

### 1. 🔒 Push and merge
`git push -u origin feature/auto-paystub` → PR to `main` → CI green (web-ci, Edge Functions fmt/lint/check).

### 2. 🔒 Web deploy with automation OFF
Worker vars: `SMART_PAYROLL_CONFIRM`, `SMART_PAYROLL_PRODUCTION_ACK`, `DOCUMENT_EXTRACTION_VERSION` **unset**.
```bash
cd web-app && npm ci && npm run cf:deploy
```
Acceptance (signed-in, real carrier account, no uploads of customer files needed):
- Settlements list/editor open; existing paystubs render; `/settlements/<id>/statement` shows DRAFT watermark on drafts.
- Documents page: upload one synthetic PDF → filed or in review; payroll card shows the "turned off" message; no settlement created (`select count(*) from settlements` unchanged).
- iPhone 2.3.6: sign in, open a settlement, scan a document — works as before.

Rollback: `npx wrangler rollback` to the previous version (`npx wrangler deployments list` to pick it).

### 3. 🔒 Migration #4 (Smart Payroll claims)
Apply `supabase/migrations_proposed/PROPOSED_20261105120000_smart_payroll_upload.sql` with the Supabase
MCP `apply_migration` / SQL editor (one transaction, `lock_timeout 15s`). Then, in the same repo commit,
rename it to `supabase/migrations/<recorded version>_smart_payroll_upload.sql` and add the version to
`migration_history_check.sql`.
Acceptance:
- 4 new nullable `documents` columns, `documents_profile_sha256_live_uidx`, table `document_payroll_claims`, 4 `sph_payroll_claim*` functions.
- Preflight (c) md5 unchanged.
- iPhone 2.3.6: scan + save a document; delete a test load with a document (cascades fine).
Rollback: `supabase/migrations_proposed/ROLLBACK_PROPOSED_20261105120000_smart_payroll_upload.sql`
(archives claims to `document_payroll_claims_archive`; tested on PG 16 and 17.6). Web keeps working
with #4 absent (it reads none of its columns; claims are only used behind the gate).

### 4. 🔒 Migration #5 (guarded automatic load creation)
Apply `PROPOSED_20261106120000_auto_create_load.sql`; rename as in step 3.
Acceptance: `sph_load_create_verified(jsonb)` exists, SECURITY INVOKER, `anon` has no EXECUTE:
```sql
select p.prosecdef, has_function_privilege('anon','public.sph_load_create_verified(jsonb)','execute') anon_exec,
       has_function_privilege('authenticated','public.sph_load_create_verified(jsonb)','execute') auth_exec
  from pg_proc p where p.proname = 'sph_load_create_verified';   -- expect f, f, t
```
Rollback: `ROLLBACK_PROPOSED_20261106120000_auto_create_load.sql` (drops the function). With #5 absent
the app creates no loads automatically (rate cons wait with "safeguard_missing").

### 5. 🔒 Edge Function v22 — staging first, then production
See `supabase/deploy/extract-document-v22/README.md` (checksums, deploy, rollback to v21, acceptance).
iPhone path is byte-identical to v21.

### 6. 🔒 Live AI extraction test (incurs OpenAI charges)
Staging first (needs a staging OpenAI key), then production with `DOCUMENT_EXTRACTION_VERSION=v3`
and **automation still OFF**. Use 5 owner-provided documents: rate con (existing load), rate con (new
load), POD, fuel receipt, lumper receipt.
Acceptance per document: `extraction_version='v3'`, every amount the owner checks against the paper is
exact, `fields.*.source_text` quotes the paper, document_type correct, confidence reported. Any wrong
amount = stop (keep automation off).

### 7. 🔒 Enable automatic drafting (loads still manual)
Vars: `SMART_PAYROLL_CONFIRM=production`, `SMART_PAYROLL_PRODUCTION_ACK=rmzqxsfhjqrshhdjzhze`,
`SMART_LOAD_AUTO_CREATE=off`. Pilot on the owner's account for one pay week.
Acceptance: each rate con on an existing load → one DRAFT settlement (status `draft`, never approved/paid),
net = driver pay rule × revenue to the cent; receipts → driver deductions only where the driver's terms
make them the driver's; lumper never added; held items show reasons.

### 8. 🔒 Enable automatic load creation
Unset `SMART_LOAD_AUTO_CREATE`. Acceptance: verified rate con for a new load → exactly one load; the
monitoring query below stays flat.

## Monitoring (read-only, daily during pilot)
```sql
-- duplicate load numbers per carrier (2 pre-existing groups on 2026-10-25; must not grow)
select count(*) from (select profile_id, upper(regexp_replace(coalesce(load_number,''),'[^A-Za-z0-9]','','g')) k
  from public.loads group by 1,2 having count(*) > 1 and length(upper(regexp_replace(coalesce(load_number,''),'[^A-Za-z0-9]','','g'))) >= 3) x;
-- automatic outcomes in the last day
select routing->'autopay'->>'state' state, count(*) from public.documents
 where updated_at > now() - interval '1 day' and routing ? 'autopay' group by 1;
-- stale pending claims (should be 0 after 15 min)
select count(*) from public.document_payroll_claims where status = 'pending' and expires_at < now();
-- nothing approved/paid by automation: every approved/paid settlement has a human transition
```

## Not part of this release
`supabase/migrations_pending/REVIEW_BEFORE_APPLYING_20261024120000_lock_finalized_settlements.sql`
breaks iPhone 2.3.6 edits; apply only after 2.3.7 is the minimum supported version.
