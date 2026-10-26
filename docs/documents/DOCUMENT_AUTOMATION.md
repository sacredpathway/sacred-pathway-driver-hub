# Document automation (web) — design, safeguards, rollout

Branch `feature/document-automation` (base `18c1ad9`). Development and local testing only; nothing deployed.

## Root cause: website uploads stayed `pending`

`app/(app)/documents/actions.ts` stored the file and inserted the `documents` row, and a comment claimed the
`extract-document` Edge Function "watches the bucket". There is no watcher (no trigger or webhook on
`documents`; the only trigger is `documents_set_updated_at`). The iPhone calls the function itself; the website
never did. Separately, v1 of the function rejects PDFs (`pdf_not_supported_provider`), so emailed rate cons
would have failed even if called.

## Flow

1. **Upload** (`registerUpload`): SHA-256 of the bytes, object stored at `<owner>/<uuid>.<ext>`, row inserted
   with `status='pending'`, `source='web'`, `content_sha256`, size, MIME, optional type hint and optional
   user-selected load (ownership checked). Same bytes uploaded before by this account → row still created
   (never refused or deleted), marked `duplicate_of` + `review_status='needs_review'`, not extracted.
2. **Trigger**: `UploadCard` calls `processDocumentAction(id)` for every new non-duplicate document, one at a
   time, showing per-file status. The review queue offers *Extract now* / *Retry* for anything pending or
   failed, so nothing silently stays pending.
3. **Extract** (Edge Function, opt-in `extraction_version: "v2"`): PDFs via Chat Completions `file` content
   parts (base64, multi-page, server-side key, no Files API upload, nothing to clean up), images via
   `image_url`. Output is sanitised (whitelisted keys per type, type/range checks, no invention) and stored with
   `extraction_version='v2'`. `persist:false` returns the result without writing (dry run). iPhone (v1) contract
   unchanged.
4. **Decide** (`decideRouting`, pure) → **apply** (`applyProposal`) under the signed-in user's RLS, with ownership
   re-checked in code. Routing never runs in the Edge Function, so iPhone scans are never auto-routed (which
   could otherwise duplicate the expense the iPhone user saves).

### PDF architecture

Chosen: **direct PDF file input** to the existing OpenAI Chat Completions call (same endpoint, same `gpt-4o`).
Supported for GPT-4o+, both text and page images are used, limit < 50 MB per request (20 MB file cap ≈ 27 MB
base64). Guards: `%PDF-` magic check, page estimate > 15 → failed with a clear reason (manual review). HEIC
is stored but not readable by OpenAI vision; it fails with `heic_not_supported`.

## Canonical taxonomy

One file, `supabase/functions/_shared/document-taxonomy.ts`, copied byte-for-byte to
`web-app/lib/documents/taxonomy.ts`; a test fails if they differ (same for the extraction helpers, except the
import specifier).

Canonical: `rate_confirmation, bol, pod, fuel_receipt, lumper_fee, toll, repair, cdl, medical_card, mvr, other`.
Legacy (kept, displayed, never routed): `paystub, invoice, receipt, settlement`.
Aliases: `lumper|lumper_receipt→lumper_fee`, `fuel→fuel_receipt`, `toll_receipt→toll`,
`maintenance|repair_bill→repair`, `rate_con|ratecon|load_sheet→rate_confirmation`, `bill_of_lading→bol`,
`proof_of_delivery|delivery_receipt→pod`, `med_card|dot_medical_card→medical_card`,
`motor_vehicle_record→mvr`. No stored value is renamed; list filters include aliases.

## Confidence model (code: `lib/documents/confidence.ts`)

| Score | Rule |
|---|---|
| model label | high 0.90 · medium 0.60 · low/missing 0.30 |
| caps | missing required field → ≤ 0.50; upload hint disagrees → ≤ 0.50; type `other` / failed parse → 0 |
| **auto classification** | **≥ 0.85** (only "high" + complete) |
| load match | exact unique normalised load # 0.70, + broker 0.20, + date ±1 day 0.20, + city 0.10 (≤ 1.0); ambiguous/fuzzy = 0 |
| driver match | exact unique full name 0.60, + CDL number on file 0.40; name/license disagreement = 0 |
| **auto match** | **≥ 0.90** (load # alone = 0.70 → review; name alone = 0.60 → review) |
| receipts | auto max fuel $2,500 · lumper $1,000 · toll $500 · maintenance $5,000; future or > 365 days old → review |

Automatic only if: no human corrections, no review reason, classification ≥ 0.85, match ≥ 0.90 (when an
entity is involved), and a non-`create_load` proposal.

## Routing

- **Rate con**: strong existing-load match → attach `documents.load_id` (the existing "no rate confirmation
  attached" check then clears naturally). Rate ≠ load total (> $1) → review. **No match → review with an
  explicit *Create load* form; never created automatically.** Create load reuses `buildCreateLoadPayload` and
  refuses when a load with the same normalised number exists.
- **BOL / POD**: strong match → attach; anything weaker → review. No new completeness rule added.
- **Receipts** (fuel/lumper/toll/repair): expense with category `fuel|lumper|toll|maintenance`, vendor, amount,
  date, description (unit/receipt # noted; `expenses` has no truck column). Load printed but not strongly
  matched → review; no load printed → unlinked expense; possible duplicate (same cents + date + compatible
  vendor) → review; protected load → review.
- **CDL / medical card / MVR**: strong driver match → `compliance_documents` row (category `driver`,
  `driver_id`, `document_kind`, issue/exam/report date, expiration when printed; MVR has none). Driver
  records are not modified.

## Review queue (Documents page)

Cards show the AI values labelled *AI suggestion · not verified*, the classification and match scores with
evidence, the reasons, and the proposed action. Actions: *Save corrections* (type, load, driver, fields — only
re-proposes), *Approve* (applies, re-checking guards), *Create load* (rate cons), *Retry/Re-extract*,
*Dismiss*. *Recently filed* lists live automatic/approved actions with *Undo*.

## Idempotency / duplicates

File hash + `duplicate_of`; conditional extraction claim (pending/failed/stale processing → processing);
conditional routing claim (`review_status IS NULL`); UNIQUE `expenses.source_document_id` and
`compliance_documents.source_document_id` (unique violation ⇒ reuse the existing row); conditional
`load_id` update; retry refused while an applied action is live; delete refused while an action is live.

## Audit / undo

`documents.routing` holds decision, scores, proposal, applied actions (target, mode automatic /
human_approved, timestamp, before/after snapshot) and history; `activity_log` gets a feed entry. Undo only if the
target still equals the snapshot; refused for documents on approved/paid settlements and for expenses on
settled/paid loads; never reverses later human edits. Created loads are not undone here.

## Payroll safety

Existing triggers untouched. New `sph_expenses_automation_guard` rejects any automation expense
(`source_document_id` set) on a settled/cancelled load or one paid by an issued/paid paystub or approved/paid
settlement (`sph_load_paid_elsewhere`). Human/iOS expenses unaffected. The app checks the same before
proposing, again at approval, and again at undo.

## Security

All web reads/writes use the signed-in user's client (RLS `profile_id = auth.uid()`), plus explicit
`profile_id` filters; client-supplied load/driver ids are re-validated; no service role in the web app; the
OpenAI key stays in the Edge Function. New guards reject cross-account `duplicate_of`, source documents, loads
and drivers. The restrictive `document settlement belongs to owner` policy is unchanged (tested).

## Rollout (each step needs its own authorization)

1. **Database migration** `20261002120000_document_automation.sql` (additive; tested twice-applied locally).
2. **Edge Function** `extract-document` (v1 unchanged; adds v2 + `persist:false`).
3. **Worker** (web app): must be AFTER 1 and 2 — uploads write the new columns and call v2.

Check before step 3: the iPhone Document Vault will see web rows with new `document_type` values (`bol`,
`pod`, `cdl`, `medical_card`, `mvr`, `lumper_fee`, `toll`, `repair`). Confirm the iOS app tolerates unknown
values (it already shows `paystub`/`rate_confirmation`) before deploying the Worker.

## Pending-document backfill (not executed)

13 legacy rows (`status='pending'`, `source IS NULL`, iPhone JPEGs from 2026-04-19; 10 share one byte size).
After steps 1–2, run `scripts/documents-backfill-dry-run.ts` with the owner's token: read-only repo (writes
throw), SHA-256 of actual bytes, duplicates not sent to the model, Edge Function `persist:false`. Per row:
id, hash, duplicate group, proposed type, extracted fields, classification score, proposed match + score,
proposed action, review required (always YES for backfill). Executing anything afterwards is a separate decision.

## Tests

- `web-app/lib/documents/*.test.ts`, `app/(app)/documents/actions.test.ts` — taxonomy parity, every type,
  sanitiser vs malicious values, thresholds, matching, routing, pipeline (trigger, failure, retry, idempotency,
  duplicates, review, payroll, cross-account, undo), upload, backfill, server actions.
- `supabase/tests/document_automation/run.sh` — migration on a throwaway Postgres (29 checks).
