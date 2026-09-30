# `loads` write contract

Why: the web New Load form and iOS Smart Scan both sent columns that
production `loads` doesn't have (`broker_contact_*`, `broker_id`,
`truck_number`, …). Nothing caught it until the write failed at runtime.

## The contract

`supabase/schema-contract/loads.columns.json` — the columns production
`public.loads` actually has, captured read-only from `information_schema`.

## What enforces it

| Client | Guard | Test |
|---|---|---|
| Web | `web-app/lib/loads/schema.ts` → `assertLoadColumns()` wraps every `loads` insert/update (create, edit, assignment) and fails with the column name before the request is sent | `lib/loads/schema.test.ts` (TS list == JSON file), `lib/loads/payloads.test.ts` (a fully-filled New Load form produces only contract columns) |
| iOS | `Load.productionColumns` + `Load.columnsMissingInProduction`; every Supabase load write goes through `LoadRemoteWritePayload` | `testRemoteWritePayloadOnlyUsesProductionColumns` (fully-populated Load → only contract keys), `testEveryModelColumnIsEitherInProductionOrExplicitlyOmitted` (adding a new `CodingKey` without classifying it fails the build's tests) |

Both clients run these in their unit tests / CI; no production access needed.

## Refreshing after an approved migration

1. Apply the migration (separately approved).
2. Read-only query:
   ```sql
   select column_name from information_schema.columns
   where table_schema = 'public' and table_name = 'loads'
   order by ordinal_position;
   ```
3. Update, together: `supabase/schema-contract/loads.columns.json`,
   `web-app/lib/loads/schema.ts`, iOS `Load.productionColumns`, and remove the
   now-supported keys from iOS `Load.columnsMissingInProduction`.

Later option (not done): generate the JSON with
`supabase gen types typescript --linked` once the web repo's migration
directory is authoritative.
