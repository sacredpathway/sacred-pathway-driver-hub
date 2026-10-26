# extract-document v22 — deployment package (NOT DEPLOYED)

Prepared 2026-10-25 on `feature/auto-paystub`. **Staging deployment was not authorized; stop here
until the owner approves.** Production runs v21 (verified below).

## What changes

| Path | v22 behaviour |
|---|---|
| no `extraction_version` (iPhone 2.3.6 / 2.3.7) | **unchanged.** v1 code path in `index.ts` is byte-identical to v21 and imports none of the changed shared code. |
| `extraction_version: "v2"` (web today) | same pipeline; prompt and taxonomy add `scale_ticket` and `accessorial`. |
| `extraction_version: "v3"` (web, only when `DOCUMENT_EXTRACTION_VERSION=v3`) | **new.** payroll prompt + `sanitizePayrollExtraction`; writes `extraction_version='v3'`. Extraction only: never creates loads, settlements, lines or links. |

The iPhone decoder (`ExtractedData`, all optional) only shares `document_type` and `notes` with the
v3 shape; both are strings, so v3 rows decode. On iPhone, v3 documents show blank extracted fields
(read-only degradation, no crash).

## Files and checksums

`MANIFEST.v22.sha256` — the six files to deploy (paths relative to `supabase/functions/`).
`MANIFEST.v21-rollback.sha256` — the five files production runs today.

Verified 2026-10-25: all five deployed v21 files (read via the Supabase API, read-only) are
byte-identical to commit `3638672`. So **rollback = redeploy `3638672`'s files.**

## Checks run

- `deno fmt --check`, `deno lint`, `deno check extract-document/index.ts` — pass (Deno 2.9.6; CI uses 1.x).
- Web twin parity and sanitizer tests: 175 pass (`web-app/lib/documents`).
- Live model extraction: **not run** (no AI usage authorized; staging has no OpenAI key and no functions).

## Deploy (owner-run, after approval) — staging first

Staging can be deployed **without** an OpenAI key first: v22 checks auth, document ownership and the storage
download before it reads `OPENAI_API_KEY`, so those paths can be accepted at zero cost (see the release checklist, Step 6a).

```bash
cd supabase/functions
shasum -a 256 -c ../deploy/extract-document-v22/MANIFEST.v22.sha256
# (optional, only for the paid live test) staging key:
# supabase secrets set --project-ref aatkirzwuuegurdlmcpl OPENAI_API_KEY=<staging key>
supabase functions deploy extract-document --project-ref aatkirzwuuegurdlmcpl --no-verify-jwt
```

`--no-verify-jwt` matches production (`verify_jwt: false`; the function verifies the JWT itself).

## Rollback (production)

```bash
git worktree add /tmp/edge-v21 3638672
cd /tmp/edge-v21/supabase/functions
shasum -a 256 -c /path/to/repo/supabase/deploy/extract-document-v22/MANIFEST.v21-rollback.sha256
supabase functions deploy extract-document --project-ref rmzqxsfhjqrshhdjzhze --no-verify-jwt
```

Rows already written with `extraction_version='v3'` stay readable by the web app (routing reads v3
through `toV2Compatible`). Set `DOCUMENT_EXTRACTION_VERSION` back to unset/`v2` on the Worker first, so
no new v3 requests are sent.

## Acceptance (staging, synthetic files only)

1. iPhone-style call (no `extraction_version`) on a synthetic rate con → response shape equals v21
   (`success, document_id, status, extracted, raw_text, model, confidence, parse_stage`).
2. `extraction_version: "v3"` → row has `extraction_version='v3'`, `extracted_data.profile='payroll'`,
   `fields.*.source_text` present, `document_type` canonical.
3. `persist: false` → no row change (`updated_at` unchanged).
4. Another account's `document_id` → `AUTH_EXPIRED`/not found; no write.
