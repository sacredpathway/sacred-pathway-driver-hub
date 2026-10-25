# Migration version map (repo ↔ production)

**Rule:** production (`rmzqxsfhjqrshhdjzhze`) is the record. A repo file's version must equal the
version production recorded, so the Supabase CLI can never treat an applied migration as new.
**Never run `supabase db push` against production from this repo** until the "production-only"
list below is empty (imported) and `supabase migration list --linked` shows no local-only rows.

Reconciled 2026-10-25 (repo-side only; production history was read, never written).

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

## Production-only versions (applied from the iPhone repo / dashboard; no file here)

`20260529221000 fix_auth_profile_trigger_search_path` · `20260529233000 harden_dispatch_role_restricted_writes` ·
`20260530103000 add_driver_mode_load_pay_fields` · `20260530120000 add_driver_mode_required_load_columns` ·
`20260530123000 sync_driver_mode_load_updates` · `20260530124000 add_dispatch_driver_contact_fields` ·
`20260530125000 add_missing_profile_equipment_columns` · `20260530130000 allow_thread_participant_contact_select` ·
`20260602000000 baseline_untracked_production_objects` · `20260604135602 add_connection_contact_fields` ·
`20260611192931 lockdown_secdef_functions_and_payroll_view` · `20260616094021 seed_apple_review_demo_dispatcher` ·
`20260705031141 expenses_receipt_image` · `20260912120000 driver_pay_and_settlements` · `20260916120000 settlement_driver_portal`

The last two are vendored verbatim for tests in `supabase/tests/web_settlements/vendor/`.
Importing all 15 as files (exact production statements) is the remaining step before the CLI can be
used; two of them (`baseline_untracked_production_objects`, `seed_apple_review_demo_dispatcher`) may
contain account data and must be reviewed by the owner before they are committed.

## Staging (`aatkirzwuuegurdlmcpl`)

Staging keeps its own apply-time versions (disposable, synthetic data): payroll_custom_categories
`20261024002354`, web_settlement_atomic_writes `20261024005237`, settlement_lock_order
`20261024084332`, smart_payroll_upload `20261024211251`. Not aligned on purpose (no history writes).

## Check (read-only)

`supabase/tests/migration_history_check.sql` lists, for a linked database, every recorded version
and whether a file with that version exists here (paste the repo list in the VALUES block).
