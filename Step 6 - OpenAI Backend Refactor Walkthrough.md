# Step 6 — OpenAI Backend Refactor Walkthrough

What changed: document scanning now goes **iPhone → Supabase Storage → Supabase Edge Function → OpenAI → Supabase database → iPhone**. The OpenAI API key lives only on the backend; the iPhone never sees it.

Do these steps in order.

---

## A. Rotate the leaked Anthropic key

The key that used to live in `Config.swift` is in your git history. Anyone who clones the repo can use it.

1. Go to https://console.anthropic.com → **API Keys**.
2. Find the key starting with `sk-ant-api03-lahE42htfL9AH_...` and click **Disable** (or Delete).

Done. The new code does not need an Anthropic key anywhere.

---

## B. Get an OpenAI API key

1. Open https://platform.openai.com/api-keys → **Create new secret key**.
2. Name: `Sacred Pathway Edge Functions`. Click **Create**.
3. Copy the key (starts with `sk-...`). You only see it once.
4. While you're there, hit **Settings → Billing → Add payment method** if you haven't yet. The vision model `gpt-4o` runs ~$0.005–$0.01 per document scan.

---

## C. Install + link the Supabase CLI

If you don't have it yet:

```bash
brew install supabase/tap/supabase
supabase login              # opens a browser
```

Then either:

**Fast path (one command does steps D–F):**

```bash
cd "/path/to/Sacred Pathway trucker tool"
./scripts/deploy.sh
```

It prompts for your project ref + OpenAI key, then chains `supabase link` → `supabase secrets set` → `supabase db push` → `supabase functions deploy`. Skip to **§G**.

**Manual path (the rest of D–F by hand):**

```bash
cd "/path/to/Sacred Pathway trucker tool"
supabase link --project-ref rmzqxsfhjqrshhdjzhze
supabase status
```

---

## D. Set the OpenAI key as a Function secret

```bash
supabase secrets set OPENAI_API_KEY=sk-your-real-key
supabase secrets set OPENAI_VISION_MODEL=gpt-4o
supabase secrets set OPENAI_TEXT_MODEL=gpt-4o-mini
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by the runtime — you don't set them.

Verify:

```bash
supabase secrets list
```

---

## E. Apply the migration (database + Storage bucket)

```bash
supabase db push
```

That runs every file in `supabase/migrations/` against your project.

To verify in the dashboard:

1. https://supabase.com/dashboard/project/rmzqxsfhjqrshhdjzhze
2. **Table Editor → documents** — new columns: `raw_text`, `status`, `error_message`, `is_manual`, `provider`, `model`, `file_mime_type`, `file_size`, `retry_count`, `updated_at`.
3. **Storage** — there's a private bucket called `documents`.

---

## F. Deploy the Edge Functions

```bash
supabase functions deploy extract-document
supabase functions deploy generate-insights
```

To smoke-test both functions in one shot:

```bash
./scripts/smoke-test.sh
```

It checks OPTIONS preflights, 401 on missing auth, a real `generate-insights` call, and that `extract-document` is reachable + returns `not_found` for a fake UUID (proving auth + DB access work). It prompts for the URL, anon key, and a test user's email + password.

Prefer raw curl?

```bash
curl -i -X POST \
  "https://rmzqxsfhjqrshhdjzhze.supabase.co/functions/v1/generate-insights" \
  -H "Authorization: Bearer <YOUR_USER_JWT>" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Say hello in five words."}'
```

Expected: `{"ok":true,"text":"...","model":"gpt-4o-mini"}`.

---

## G. Build the iOS app

The iPhone now needs nothing extra — no Secrets.plist, no API keys.

1. Open `SacredPathway.xcodeproj` in Xcode.
2. Press **⌘R**.
3. Sign in with your test account.
4. Tap **+ Add Document → Scan Document** (camera) or **Files** (PDF).
5. You should see "AI is reading your document…" for ~3–8 seconds, then the editable Review screen.
6. Edit fields, tap **Save Load** — the success alert appears.

---

## H. Verify the round-trip

In Supabase:

1. **Table Editor → documents** → newest row:
   - `status = 'processed'`
   - `extracted_data` is the JSON OpenAI returned
   - `raw_text` is the literal model output
   - `storage_path` points into the `documents` bucket
   - `model = 'gpt-4o'`
   - `load_id` is filled in once you tapped Save
2. **Storage → documents** → expand the folder named with your `profile_id` (UUID) → your file is there.
3. **Edge Functions → extract-document → Logs** — every invocation shows up here. Errors are logged in full.

---

## I. Failure modes

| Symptom | Likely cause | Where to look |
|---|---|---|
| `Backend error (401): missing_auth` | iPhone session expired | Sign out + back in |
| `Backend error (401): invalid_jwt` | Function couldn't verify the user | Same |
| `openai_error` / `http_429` | OpenAI rate limit; backend retries 3× | OpenAI dashboard usage |
| `storage_download_failed` | Bucket missing or RLS misconfigured | Re-run `supabase db push` |
| `invalid_json` in the response | gpt-4o produced unparseable output | Tap "Enter Manually" — row is marked `manual` and the file is still saved |
| Function returns instantly with no extraction | `OPENAI_API_KEY` unset | `supabase secrets list` |
| Function logs show `missing_api_key` | Same as above | Same |

---

## J. Local development (optional)

To run the functions on your laptop without deploying:

```bash
cp supabase/.env.example supabase/.env
# Fill in OPENAI_API_KEY in supabase/.env
supabase functions serve extract-document --env-file supabase/.env
```

Point the iPhone at `http://<your-mac-ip>:54321` for the function URL by temporarily editing `Config.supabaseURL`.

---

## K. Clean-up

- Confirm `git status` does NOT list `supabase/.env` (the example is committed; the real one is gitignored — see `supabase/.env.example`).
- The duplicate `SacredPathway-Source/` folder still has the old code. If you don't use it anywhere, delete it. If you do, mirror the same changes there.

---

You're done. Phase 1 of the launch checklist resumes at TestFlight upload.
