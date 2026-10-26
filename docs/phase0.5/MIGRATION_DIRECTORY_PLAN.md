# Plan: make `sacred-pathway-driver-hub/supabase/migrations` authoritative

**Plan only — nothing moved, renamed, deleted or applied in Phase 0.5.**

Target: web repo `supabase/migrations/` holds exactly the 37 migrations
production has applied, byte-identical to what production ran; pending work
lives in `supabase/migrations_pending/` where `supabase db push` never sees it.

## Step 1 — add the 15 applied files the web repo lacks (copy from iOS repo)

Copy verbatim from `SacredPathwayDriverHub/supabase/migrations/`:

```
20260529221000_fix_auth_profile_trigger_search_path.sql
20260529233000_harden_dispatch_role_restricted_writes.sql
20260530103000_add_driver_mode_load_pay_fields.sql
20260530120000_add_driver_mode_required_load_columns.sql
20260530123000_sync_driver_mode_load_updates.sql
20260530124000_add_dispatch_driver_contact_fields.sql
20260530125000_add_missing_profile_equipment_columns.sql
20260530130000_allow_thread_participant_contact_select.sql
20260602000000_baseline_untracked_production_objects.sql
20260604135602_add_connection_contact_fields.sql
20260611192931_lockdown_secdef_functions_and_payroll_view.sql
20260616094021_seed_apple_review_demo_dispatcher.sql
20260705031141_expenses_receipt_image.sql
20260912120000_driver_pay_and_settlements.sql
20260916120000_settlement_driver_portal.sql
```

## Step 2 — replace one divergent file

`20260529123000_harden_sacred_dispatch.sql`: replace the web copy (16
statements) with the iOS-repo copy (8 statements) — the one production
recorded. The 4 extra policies in the web copy already exist in production
(created by `20260529100000`), so nothing is lost.

## Step 3 — leave the 21 comment/whitespace-only differences alone

Code-identical after stripping comments/blank lines; optional to sync.

## Step 4 — park pending files

Create `supabase/migrations_pending/` and copy (not move) the five 2.3.5-RC
files there with a README pointing at PENDING_MIGRATION_REVIEW.md.

## Step 5 — guardrail

Add a CI job: every file in `supabase/migrations/` must have a version present
in a committed `supabase/applied_versions.txt` (updated only when a migration
is applied), so a local-only file can't slip in.

## Step 6 — iOS repos

Add a `supabase/migrations/README.md` in the iOS repo and the 2.3.5-RC
worktree: "Not authoritative — see sacred-pathway-driver-hub". Delete their
copies only in a later, separately approved change.

## Verification before merging that change

`supabase migration list --linked` (read-only) must show local = remote for
all 37 versions and no extras.
