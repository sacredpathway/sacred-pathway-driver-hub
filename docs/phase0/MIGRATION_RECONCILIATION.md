# Supabase migration reconciliation — 2026-09-30

Read-only. **Nothing was applied, moved, renamed or deleted.**

Sources compared:

| Source | Location | Files |
|---|---|---|
| Production | `supabase_migrations.schema_migrations`, project `rmzqxsfhjqrshhdjzhze` | 37 applied |
| iOS repo | `~/Developer/SacredPathwayDriverHub/supabase/migrations` (github `sacredpathway/-SacredPathwayDriverHub`, branch `feature/settlements-cloud-build`) | 37 |
| Web repo | `~/Developer/sacred-pathway-driver-hub/supabase/migrations` (github `sacredpathway/sacred-pathway-driver-hub`) | 22 |
| 2.3.5-RC | `~/Developer/SacredPathwayDriverHub-2.3.5-RC/supabase/migrations` (git worktree of `~/Developer/SacredPathway-stable`) | 18 (17 + 1 `REVIEW_BEFORE_APPLYING_*`) |

## 1. iOS repo vs production — exact match

All 37 production versions are present, no extras. For the one file whose SQL
differs between repos (`20260529123000_harden_sacred_dispatch`), the iOS-repo
version has 8 statements, matching the 8 statements production recorded.

## 2. Web repo vs production

- **Missing 15 applied migrations** (everything after `20260529140000`):
  `20260529221000` … `20260916120000`, including both settlement migrations.
- No local-only files.
- 21 of 22 shared files differ from the iOS repo **only in comments/whitespace**
  (verified by diffing with comments and blank lines stripped).
- `20260529123000_harden_sacred_dispatch` has **real SQL differences**: the web
  copy adds 4 `create policy` blocks (dispatch agreements/threads scoped
  select/update). Production ran the shorter iOS version, but those 4 policies
  **do exist in production** (created by `20260529100000_create_sacred_dispatch`),
  so there is no effective schema drift — just a divergent file.

## 3. 2.3.5-RC folder vs production

Present locally, **NOT applied to production**:

| File | What it does | Risk |
|---|---|---|
| `20260529090000_add_driver_equipment_profile` | adds `profiles.truck_number/trailer_number` (already in prod via `20260530125000`) **and `loads.truck_number/trailer_number` (NOT in prod)** | iOS 2.3.5 `Load` encodes `truck_number`/`trailer_number` when set → PostgREST rejects the insert/update with "column not found". Needs a decision before 2.3.5 ships. |
| `20260614020000_create_roadside_stops` | `roadside_saved_stops`, `roadside_parking_reports`, `sph_has_maps_access()` | iOS `RoadsideStopsStore.swift` queries both tables → those calls fail in prod today. |
| `20260614030000_add_nearby_roadside_parking_reports_rpc` | RPC for the above | same |
| `20260614120000_rebrand_sacred_path_comments` | comments only | none |
| `REVIEW_BEFORE_APPLYING_20260614130000_sacred_path_report_privacy_hardening` | replaces the nearby-reports RPC | explicitly parked by its filename |

Applied to production but **absent** from this folder: 24 (it only carries the
dispatch/driver-mode/roadside subset plus the two settlement migrations).

## 4. Files applied to production but absent from every repo

**None.** Every production version exists in the iOS repo.

## 5. Recommendation — one authoritative directory

**`sacred-pathway-driver-hub/supabase/migrations` (web repo) should become
authoritative**, seeded from the iOS repo's exact 37 files, because:

- the web repo already owns `supabase/config.toml`, the Edge Functions and the
  functions CI — it is the backend repo;
- the iOS repo's set is the only one that matches production byte-for-byte in
  effect;
- iOS and web both consume the same database, so the schema should live with the
  backend, not inside one client.

Proposed steps (NOT done — each needs approval):

1. Copy the 15 missing files from the iOS repo into the web repo; replace
   `20260529123000_harden_sacred_dispatch.sql` with the iOS (production) copy.
2. Move the 2.3.5-RC-only files into `supabase/migrations_pending/` in the web
   repo so `supabase db push` can never pick them up by accident.
3. Leave the iOS repo's copy in place, marked read-only in a README, until the
   iOS CI no longer references it. Nothing is deleted.
4. Add a CI check that fails when a migration file's version is not in the
   committed list.
