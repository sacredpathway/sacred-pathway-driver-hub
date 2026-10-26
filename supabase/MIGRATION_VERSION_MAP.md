# Migration version map (repo ↔ production)

**Rule:** production (`rmzqxsfhjqrshhdjzhze`) is the record. A repo file's version must equal the
version production recorded, so the Supabase CLI can never treat an applied migration as new.
**Never run `supabase db push` against production from this repo** until the "production-only"
list below is empty (imported) and `supabase migration list --linked` shows no local-only rows. (Import done 2026-10-25; see below.)

Reconciled 2026-10-25 (repo-side only; production history was read, never written). Repo and production now list the same 43 versions.

## Current status (2026-10-26)

| # | Repo file | Production | Staging |
|---|---|---|---|
| 4 | `migrations/20261025225011_smart_payroll_upload.sql` | `20261025225011` | `20261024211251` |
| 5 | `migrations/20261026003052_auto_create_load.sql` | `20261026003052` | `20261025174009` |
| 6 | `migrations_proposed/PROPOSED_20261107120000_verified_rate_con_safeguard.sql` | **not applied** | `20261026035158` |

Production = **45** versions, all with a file in `supabase/migrations/`. #6 stays in `migrations_proposed/` (not picked up
by the CLI) until production applies it; then rename it to `<production version>_verified_rate_con_safeguard.sql` in the
same commit. Rollback: `migrations_proposed/ROLLBACK_PROPOSED_20261107120000_verified_rate_con_safeguard.sql` (restores
#5's function byte-identical). #6 must ship together with the web build that sends `document_id`
(see `RELEASE_AUTO_PAYSTUB.md` Step 5b). The #4 / #5 notes further down are historical.

## Renamed to the production version (content byte-identical)

| Old repo file | Production version | sha256 (unchanged) |
|---|---|---|
| `20261023120000_payroll_custom_categories.sql` | `20261024011809` | `4f6477ca…61568` |
| `20261023130000_web_settlement_atomic_writes.sql` | `20261024012624` | `3a5b3456…18ada` |
| `20261023140000_settlement_lock_order.sql` | `20261024092246` | `d4b18f2d…63c30` |

Production stored #3's text without the trailing newline; the resulting functions are identical
(`sph_web_save_settlement` def md5 `e733ed7a…`, `sph_web_transition_settlement` `86ce3cec…`).

## Moved out of `supabase/migrations/` (never applied anywhere)

| File | Now | Why |
|---|---|---|
| `REVIEW_BEFORE_APPLYING_20261024120000_lock_finalized_settlements.sql` | `supabase/migrations_pending/` | Breaks iPhone 2.3.6 edits; apply only after 2.3.7 is the minimum version (separate approval). |

`supabase/migrations_proposed/PROPOSED_20261105120000_smart_payroll_upload.sql` (#4) stays proposed:
staging recorded it as `20261024211251`; production has **not** applied it. When it is applied to
production, rename it to `<production version>_smart_payroll_upload.sql` in the same commit.

## Imported from production 2026-10-25 (read-only; production history untouched)

All 15 versions that production had applied with no file here are now in `supabase/migrations/`,
built from `supabase_migrations.schema_migrations.statements` (`array_to_string(statements, ';\n\n') || ';\n'`).
Production now has **43** versions and the repo has the **same 43** (same versions, same names).

| Version | Name | Source | Check vs production |
|---|---|---|---|
| 20260529221000 | fix_auth_profile_trigger_search_path | iPhone repo | byte md5 `1529481b…` |
| 20260529233000 | harden_dispatch_role_restricted_writes | iPhone repo | normalized ¹ |
| 20260530103000 | add_driver_mode_load_pay_fields | iPhone repo | byte md5 `6600fe26…` |
| 20260530120000 | add_driver_mode_required_load_columns | iPhone repo | normalized ¹ |
| 20260530123000 | sync_driver_mode_load_updates | iPhone repo | byte md5 `cff048d3…` |
| 20260530124000 | add_dispatch_driver_contact_fields | iPhone repo | byte md5 `5ddf7691…` |
| 20260530125000 | add_missing_profile_equipment_columns | iPhone repo | byte md5 `6d153977…` |
| 20260530130000 | allow_thread_participant_contact_select | iPhone repo | normalized ¹ |
| 20260602000000 | baseline_untracked_production_objects | production text | byte md5 `6c481de8…` (68,428 B) |
| 20260604135602 | add_connection_contact_fields | production text | byte md5 `7defc23c…` |
| 20260611192931 | lockdown_secdef_functions_and_payroll_view | production text | byte md5 `81b451fd…` |
| 20260616094021 | seed_apple_review_demo_dispatcher | production text, **redacted** ² | body md5 `df13bce0…` |
| 20260705031141 | expenses_receipt_image | production text | byte md5 `db9efd60…` |
| 20260912120000 | driver_pay_and_settlements | iPhone repo | normalized ¹ |
| 20260916120000 | settlement_driver_portal | iPhone repo | normalized ¹ |

¹ The CLI stores a file split into statements, so a byte md5 can differ by whitespace/`;`. "normalized" =
md5 after removing `--` comments, whitespace and `;` on both sides — equal for every file except ².

² Two plaintext demo passwords were replaced with `<REDACTED-demo-password-see-owner-vault>`.
Original md5 `0312110ca5d03d1c4f3d34bcada91a80`. The file deletes and recreates the Apple review demo
accounts: **already applied, never re-run on production.** Replayed on a scratch database it creates the
demo accounts with the placeholder password (harmless; not a real credential). **The real demo passwords
are still readable by anyone with production SQL access in `schema_migrations` — rotate them.**

### Corrected existing file

`20260529123000_harden_sacred_dispatch.sql` had four policy statements (agreements/threads scoped
select + update) appended after production applied it. Restored to production's exact text
(md5 `2b44b919…`, 2,581 B). No effect on the end state: the two select policies are recreated by
`20260602000000` §9 and the two update policies are replaced by `20260529233000`. Production policy
definitions checked read-only 2026-10-25.

### Verification (re-runnable)

All 43 files: normalized md5 equals production for 42; the 43rd is the redacted seed. 16 of 43 are
also byte-identical (the rest differ only in whitespace/statement splitting). Query used (read-only):
`select version, md5(regexp_replace(regexp_replace(t,'--[^\n]*','','g'),'[\s;]+','','g')) from (select version, array_to_string(statements, E';\n\n')||E';\n' t from supabase_migrations.schema_migrations) x;`

**`supabase db push` is still not authorized.** Before any CLI use against production: run
`supabase migration list --linked` and confirm zero LOCAL-only rows (the proposed #4/#5 live in
`migrations_proposed/`, so they are not picked up).

## Staging (`aatkirzwuuegurdlmcpl`)

Staging keeps its own apply-time versions (disposable, synthetic data): payroll_custom_categories
`20261024002354`, web_settlement_atomic_writes `20261024005237`, settlement_lock_order
`20261024084332`, smart_payroll_upload `20261024211251`. Not aligned on purpose (no history writes).

## Check (read-only)

`supabase/tests/migration_history_check.sql` lists, for a linked database, every recorded version
and whether a file with that version exists here (paste the repo list in the VALUES block).
