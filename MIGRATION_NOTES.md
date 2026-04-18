# Migration notes — Anthropic → OpenAI (backend extraction)

**Date:** 2026-04-17
**Scope:** Document scanning + AI insights pipeline
**Impact:** iOS app (SacredPathway), Supabase Postgres, Supabase Storage, Supabase Edge Functions

---

## What changed, one paragraph

Document extraction used to run on the iPhone: `ClaudeAIService` base64-encoded the scanned image, called `api.anthropic.com` directly with a hardcoded key, and stashed the resulting JSON on the Load/Expense the user created. It now runs on the backend: the iPhone uploads the file to a private Supabase Storage bucket, inserts a `documents` row, and asks the `extract-document` Edge Function to do the extraction. The function calls OpenAI `gpt-4o`, persists the structured JSON + raw model response + confidence to the row, and returns the structured payload to the iPhone. The OpenAI key lives only on the backend. Weekly insight summaries moved the same way: `SmartInsightsView` → `generate-insights` Edge Function.

---

## Architecture before / after

**Before**

```
iPhone
 ├─ ClaudeAIService.extractData(image)
 │     └─ POST api.anthropic.com/v1/messages   (key hardcoded in Config.swift)
 └─ SupabaseService.uploadDocument(jpeg)       (row in documents, no extracted_data)
```

**After**

```
iPhone
 ├─ SupabaseService.uploadDocument(jpeg, "image/jpeg")   → Storage
 ├─ SupabaseService.createDocument(status=pending)        → documents row
 └─ DocumentExtractionService.extract(documentId)
          │
          ▼
 Supabase Edge Function `extract-document`  (holds OPENAI_API_KEY)
          ├─ downloads file from Storage via service role
          ├─ POST api.openai.com/v1/chat/completions (gpt-4o, json_object)
          ├─ UPDATE documents SET extracted_data/raw_text/status/model/confidence
          └─ returns structured JSON to iPhone
          ▼
 iPhone shows editable fields → Save → patch documents row + create Load/Expense
```

---

## Files touched

### New
- `supabase/config.toml`
- `supabase/.env.example`
- `supabase/migrations/20260417120000_openai_documents.sql`
- `supabase/functions/_shared/cors.ts`
- `supabase/functions/_shared/openai.ts`
- `supabase/functions/extract-document/{index.ts,deno.json}`
- `supabase/functions/generate-insights/{index.ts,deno.json}`
- `SacredPathway/SacredPathway/Services/DocumentExtractionService.swift`
- `SacredPathway/SacredPathway/Services/InsightsService.swift`
- `scripts/deploy.sh`
- `scripts/smoke-test.sh`
- `.github/workflows/ci.yml`
- `.gitignore`
- `Step 6 - OpenAI Backend Refactor Walkthrough.md`

### Modified
- `SacredPathway/SacredPathway/Config.swift` — Anthropic key removed; exposes function names + bucket
- `SacredPathway/SacredPathway/Models/TruckDocument.swift` — adds `rawText`/`status`/`errorMessage`/`isManual`/`provider`/`model`/`fileMimeType`/`fileSize`/`retryCount`/`updatedAt`; introduces `DocumentStatus` enum
- `SacredPathway/SacredPathway/Services/SupabaseService.swift` — adds `updateDocument`, `patchDocument`, multi-MIME upload, `signedURL`, `deleteStorageObject`, generic `invokeFunction<Req,Res>`
- `SacredPathway/SacredPathway/Services/DocumentScannerCoordinator.swift` — `FilePickerView` now returns `PickedDocument`
- `SacredPathway/SacredPathway/Views/Scanner/ScanUploadView.swift` — plumbs picker bytes through
- `SacredPathway/SacredPathway/Views/Scanner/DocumentReviewView.swift` — full rewrite around the backend pipeline
- `SacredPathway/SacredPathway/Views/Insights/SmartInsightsView.swift` — calls `InsightsService.generate`
- `privacy.html`, `privacy_policy.html`, `AppStoreConnect_Fields.md` — OpenAI wording, clarify server-to-server

### Deleted
- `SacredPathway/SacredPathway/Services/ClaudeAIService.swift`

---

## Database changes (`supabase/migrations/20260417120000_openai_documents.sql`)

Adds to `documents`:

| Column | Type | Purpose |
|---|---|---|
| `raw_text` | TEXT | Literal model response — audit trail |
| `status` | TEXT NOT NULL | `pending`, `processing`, `processed`, `failed`, `manual` (CHECK constraint) |
| `error_message` | TEXT | Human-readable failure detail |
| `is_manual` | BOOLEAN NOT NULL | User hit "Enter Manually" escape hatch |
| `provider` | TEXT NOT NULL | `openai` or `manual` |
| `model` | TEXT | e.g. `gpt-4o` |
| `file_mime_type` | TEXT | What the iPhone uploaded |
| `file_size` | INTEGER | Bytes |
| `retry_count` | INTEGER NOT NULL | Bumped by the iPhone retry button |
| `updated_at` | TIMESTAMPTZ | BEFORE-UPDATE trigger keeps it fresh |

Indexes: `(profile_id, status)`, `(profile_id, created_at DESC)`.

Storage: creates a private `documents` bucket (20 MB cap, image + pdf MIMEs) and four RLS policies on `storage.objects` that restrict access to objects under `<profile_id>/`.

**Idempotent.** Safe to re-run. Backfills `status` from the legacy `processed` bool.

---

## Edge Function secrets

Set once with `./scripts/deploy.sh` or manually:

```bash
supabase secrets set OPENAI_API_KEY=sk-...
supabase secrets set OPENAI_VISION_MODEL=gpt-4o
supabase secrets set OPENAI_TEXT_MODEL=gpt-4o-mini
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are auto-injected.

---

## Test checklist

After `./scripts/deploy.sh` completes, run `./scripts/smoke-test.sh`. Then in the iOS app:

1. **Camera scan → rate con**
   - Status progresses: pending → processing → processed
   - Review screen shows broker, load #, origin, destination, revenue
   - Save → Load appears in Loads list; `documents` row has `load_id`, `extracted_data`, `raw_text`
2. **File upload → PDF of a rate con**
   - PDF first page is rendered and uploaded as JPEG (see `uploadOriginalFile`)
   - Same round-trip as above
3. **Photo upload → fuel receipt**
   - Detected as `fuel_receipt`, review screen shows vendor / amount / gallons / $/gal
   - Save → Expense appears in Expenses list
4. **Deliberate failure → bad key**
   - `supabase secrets unset OPENAI_API_KEY` → redeploy → scan a doc
   - Expect: error screen with "Try Again" + "Enter Manually"
   - Tap Manual → row status flips to `manual`, user can key fields in
5. **Dashboard → weekly summary**
   - `generate-insights` returns a 3-4 sentence blurb
6. **RLS sanity**
   - Sign in as user A, note a document id
   - Sign in as user B, try to PATCH that id via PostgREST → 404/403

---

## Rollback

If the OpenAI flow misbehaves and you need the old Anthropic path back **fast**:

1. Revert the repo to the commit tagged before this refactor (or to `main@{before 2026-04-17}`).
2. **Do not re-use the old Anthropic key.** It's in git history and should be treated as compromised. Generate a fresh one in console.anthropic.com and paste into `Config.swift`.
3. Rebuild + reinstall the iOS app via TestFlight.
4. The DB columns added by the migration are additive — they don't break the old code, so you can leave them. If you want to be tidy:
   ```sql
   ALTER TABLE documents
     DROP COLUMN raw_text,
     DROP COLUMN status,
     DROP COLUMN error_message,
     DROP COLUMN is_manual,
     DROP COLUMN provider,
     DROP COLUMN model,
     DROP COLUMN file_mime_type,
     DROP COLUMN file_size,
     DROP COLUMN retry_count,
     DROP COLUMN updated_at;
   ```
5. The Edge Functions can stay deployed or be removed with:
   ```bash
   supabase functions delete extract-document
   supabase functions delete generate-insights
   ```

---

## Known limitations + follow-ups

- **PDF originals not preserved.** The iPhone renders a PDF's first page to JPEG before upload because gpt-4o Chat Completions vision only accepts image MIMEs. Future enhancement: upload a `<path>.original.pdf` sidecar and add an `original_storage_path` column on `documents` so drivers can re-download their original file.
- **Multi-page rate cons.** Only page 1 is sent to OpenAI. For multi-page docs, a fan-out extraction pass per page would be a separate PR.
- **No background re-extraction.** If the function fails transiently, the iPhone's retry button is the only path. A scheduled job that picks up `status='failed'` rows and re-runs them is a natural next step.
- **Edge Function cold starts.** First invocation after 5–10 min of idle can take ~500 ms. Usually invisible behind the upload step.

---

## Security posture

- OpenAI key never ships to client. ✓
- Supabase Storage bucket is private (RLS per `profile_id`). ✓
- `extract-document` validates the caller's JWT and cross-checks `documents.profile_id = auth.uid()` before downloading from Storage. ✓
- CI guardrail fails builds that reintroduce `api.anthropic.com` / `x-api-key` / `sk-ant-` / `anthropicAPIKey` / live `ClaudeAIService.` calls. ✓
- Anthropic key that was previously in `Config.swift` should still be rotated in console.anthropic.com — it's in git history.
