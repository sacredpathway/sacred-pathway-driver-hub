# Pending migration review — 2026-09-30 (read-only)

Source folder: `~/Developer/SacredPathwayDriverHub-2.3.5-RC/supabase/migrations`.
**None of these files was applied, renamed, moved or edited.** Production facts
below were read with SELECT-only queries against `rmzqxsfhjqrshhdjzhze`.

Relevant production state:

- `profiles.truck_number` / `profiles.trailer_number` **exist**; `loads.truck_number` / `loads.trailer_number` **do not**.
- `sph_touch_updated_at()` **exists** as `SECURITY DEFINER`, used by triggers on `settlements`, `recurring_deductions`, `driver_advances`, `drivers`.
- `sph_has_maps_access()` does **not** exist. `sph_current_account_role()` exists.
- PostGIS is **available but not installed** (only `pgcrypto` is installed).

---

## 1. `20260529090000_add_driver_equipment_profile.sql`

| Item | Detail |
|---|---|
| Tables added | none |
| Columns added | `profiles.truck_number`, `profiles.trailer_number` (**already in prod** via `20260530125000`), `loads.truck_number`, `loads.trailer_number` (new) |
| Indexes / triggers / functions / RLS / storage | none |
| Destructive statements | none (`add column if not exists`, `comment on column`) |
| Dependencies | none |
| iOS feature | per-load truck/trailer snapshot in Manual Load Entry + Smart Scan (`Load.truckNumber/trailerNumber`) |
| Safe independently | yes — idempotent, nullable, no backfill |
| Depends on another pending file | no |
| Rollback | easy (`alter table loads drop column truck_number, drop column trailer_number` — loses only values written after apply) |
| Timestamp note | version `20260529090000` is **older** than applied migrations; `supabase db push` will refuse or need `--include-all`. Re-stamp with a current timestamp before applying. |
| **Recommendation** | **APPLY LATER** (after re-stamping; profile half is a no-op). Then remove `.truckNumber/.trailerNumber` from `Load.columnsMissingInProduction`. |

## 2. `20260614020000_create_roadside_stops.sql`

| Item | Detail |
|---|---|
| Tables added | `roadside_saved_stops`, `roadside_parking_reports` |
| Columns | full definitions; CHECKs on `account_role`, `stop_category`, `parking_status`; unique `(user_id, stop_id)` on both |
| Indexes | 4 btree (user/updated, stop/updated, lat/long ×2) |
| Functions | **new** `sph_has_maps_access()` (SECURITY DEFINER); **`create or replace sph_touch_updated_at()` WITHOUT `security definer`** |
| Triggers | touch-updated_at on both new tables |
| RLS | enabled; saved stops own-row CRUD; parking reports **"read maps community": every carrier/owner-op can SELECT every user's raw report rows (notes, user_id, account_role, exact lat/long)** |
| Grants | CRUD to `authenticated` on both tables |
| Storage | none |
| Destructive | `drop trigger/policy if exists` on its own new objects only |
| Dependencies | `sph_current_account_role()` (exists), `auth.users` |
| iOS feature | Maps → Sacred Path saved places + parking reports cloud sync (`SacredPathStore`) — now gated off by `MapFeatureFlags.sacredPathCloudSyncEnabled = false` |
| Safe independently | **no** |
| Why | (a) silently redefines the shared `sph_touch_updated_at()` used by 4 settlement/driver triggers, changing it from SECURITY DEFINER to INVOKER — body is identical so behaviour is *probably* unchanged, but it is an undeclared change to financial tables; (b) ships the broad community SELECT policy that file #5 exists to remove |
| Depends on another pending file | #3 and #5 build on it |
| Rollback | moderate: drop 2 tables + function; restoring `sph_touch_updated_at` needs the original SECURITY DEFINER definition re-applied |
| **Recommendation** | **REWORK FIRST** — give the new tables their own trigger function (e.g. `sph_roadside_touch_updated_at`) instead of replacing the shared one, and ship owner-only SELECT from the start (fold #5 in). |

## 3. `20260614030000_add_nearby_roadside_parking_reports_rpc.sql`

| Item | Detail |
|---|---|
| Extensions | **`create extension if not exists postgis`** into schema `extensions` (not installed in prod today) |
| Columns added | `roadside_parking_reports.location geography(Point,4326)` **generated stored** from lat/long |
| Indexes | GiST on `location` |
| Functions | `sph_nearby_roadside_parking_report_summaries(...)` SECURITY INVOKER, returns aggregates only; `set search_path = public, extensions` at session level |
| RLS / storage | none new |
| Destructive | none |
| Dependencies | #2 (table), PostGIS |
| iOS feature | nearby parking summaries (`fetchNearbyParkingReportSummaries`) |
| Safe independently | no (needs #2) |
| Rollback | moderate: drop function, index, column; `drop extension postgis` only if nothing else adopts it |
| Note | Being INVOKER, it can only aggregate rows the caller can SELECT — it works *because* of #2's broad community policy. Once #5 restricts SELECT to owner-only, this version would summarise only the caller's own reports. |
| **Recommendation** | **REWORK FIRST** — superseded in practice by #5's definer version; installing PostGIS in prod is its own decision. |

## 4. `20260614120000_rebrand_sacred_path_comments.sql`

| Item | Detail |
|---|---|
| Changes | `comment on` 1 function + 2 tables + 1 RPC — metadata only |
| Destructive | none |
| Dependencies | **#2 and #3** (fails if those objects don't exist) |
| iOS feature | none |
| Rollback | trivial |
| **Recommendation** | **OBSOLETE** as a separate file — fold the wording into the reworked #2/#3. Applied alone it errors. |

## 5. `REVIEW_BEFORE_APPLYING_20260614130000_sacred_path_report_privacy_hardening.sql`

The filename is a warning, not an approval. It is **not** treated as approved.

| Item | Detail |
|---|---|
| Purpose | Fix the privacy finding in #2: other users can read raw notes/identity/location |
| Functions | replaces the nearby RPC as **SECURITY DEFINER** with an explicit `sph_has_maps_access()` guard, returning counts/latest status only |
| RLS | drops "read maps community"; adds owner-only SELECT |
| Destructive | drops one policy (its own feature's) |
| Dependencies | #2, #3, PostGIS |
| Safe independently | no |
| Open questions before it can be trusted | (1) the definer function has no `revoke execute from public/anon` — only `grant … to authenticated`; Postgres grants EXECUTE to PUBLIC by default, so anon callers reach it (guard returns false for them, but the lint pattern the project already fixed in `20260611192931` should be applied); (2) aggregates can still reveal that *someone* reported at a precise stop — acceptable? (3) it needs a test on a Supabase branch, as its own header says |
| Rollback | easy (re-create prior policy/function) |
| **Recommendation** | **NEEDS INVESTIGATION** — its intent is right and should be folded into the reworked #2/#3, with `revoke all … from public, anon` added and a branch test. |

---

## Suggested path (not done)

1. Apply #1 (re-stamped) when you approve per-load equipment in the cloud.
2. Replace #2–#5 with **one** reworked, re-stamped migration: own trigger fn,
   owner-only SELECT, definer aggregate RPC with explicit revoke/grant, PostGIS
   decision recorded. Test on a Supabase branch. Then flip
   `MapFeatureFlags.sacredPathCloudSyncEnabled` to `true` in the same iOS build.
