# Credential exposure — findings and rotation procedure (2026-10-25)

All checks read-only. **No password or key is reproduced in this file, in commits or in reports.**
Nothing has been rotated yet: every step below is owner-run.

## Findings

| # | What | Where it is exposed | Since | Status |
|---|---|---|---|---|
| F1 | Password of the App Review account `demarquishinton+appreview@gmail.com` (id `5150a545-…`) | `AppStoreConnect_Fields.md` on **every public GitHub branch** (main, feature/auto-paystub, feature/carrier-hq, fix/*) and in Git history | 2026-04-18 (commit `82afa2d`) | **Treat as compromised.** Removed from the tracked file in local commit `873080a` (not pushed); still in history. |
| F2 | Passwords of `dispatcher.demo@…` (`0357bef0-…`) and `driver.demo@…` (`bb000000-…`) | Plaintext in production `supabase_migrations.schema_migrations` (version `20260616094021`). `anon`/`authenticated`/`public` have **no** grants on that table; readable only with database/dashboard access. **Never in Git** (scan below). | 2026-06-16 | Rotate or disable. |
| F3 | Leaked-password protection is **off** in Supabase Auth (security advisor) | — | pre-existing | Turn on. |
| F4 | GitHub repo `sacredpathway/sacred-pathway-driver-hub` is **public** (page loads signed out) | — | — | Owner decision; see below. |

F1 account state (production, read-only): confirmed, not banned, no MFA, 0 active sessions, 0 live refresh
tokens; owns 10 loads, 6 documents, 2 drivers, 0 settlements; **last sign-in 2026-10-23 04:51 UTC**
(cannot be attributed: the auth audit table holds no login history). F2 accounts: 0 sessions, no
data; dispatcher never signed in, driver last 2026-06-16.

## Secret scan of the repository (tracked files + full history)

919 unique blobs across all 68 commits on every local and GitHub branch, 16 pattern families
(OpenAI/Anthropic/Stripe/GitHub/AWS/Google/Slack/Supabase keys and tokens, JWTs incl. service-role,
private-key blocks, DB URLs with passwords, password/secret assignments, `crypt('…')` literals), plus
sensitive file names (`.env`, `.p8`, `.p12`, `.pem`, keystores, `GoogleService-Info`, `AuthKey*`).

- **No usable keys, tokens, JWTs, private keys or DB passwords** found anywhere in history.
- `Step 6 - OpenAI Backend Refactor Walkthrough.md`: a **27-character fragment** of an Anthropic key
  (a full key is ~100 characters), inside instructions to disable that old key. Not usable; confirm that key is
  disabled in the Anthropic console.
- Only `.env` files ever committed: `supabase/.env.example`, `web-app/.env.local.example` — placeholders.
- The only real credential in Git is F1.

## Rotation procedure (owner-run, in this order)

Uses `scripts/rotate_review_credentials.sh`: secrets are typed at hidden prompts, never passed as
arguments or env vars, kept in a mode-600 temp file deleted on exit, and never printed.

1. **Check which account App Store Connect uses** (App Store Connect → the app → 2.3.6 → App Review
   Information → Sign-in). Project notes (2026-10-06) say 2.3.6 uses `+review235`; confirm.
2. **F1 — rotate `+appreview`.** Generate a new 20+ char password in your password manager, then:
   ```bash
   cd ~/Developer/sacred-pathway-driver-hub
   scripts/rotate_review_credentials.sh rotate 5150a545-5962-463d-b688-3370c6b55c8e
   ```
   Expect `HTTP 200` and `updated_at` = now. If App Store Connect uses this account, paste the new
   password there **in the same sitting** (a review in progress would otherwise fail to sign in).
   If it is no longer used for review: `… disable 5150a545-5962-463d-b688-3370c6b55c8e` instead.
3. **F2 — dispatch demo accounts.** If no app review uses them: disable (reversible):
   ```bash
   scripts/rotate_review_credentials.sh disable 0357bef0-e75a-4142-a56b-d0749c3c6a2e
   scripts/rotate_review_credentials.sh disable bb000000-0000-4000-8000-000000000002
   ```
   Otherwise `rotate` each and update the review notes that reference them.
4. **F3** — Dashboard → Authentication → Providers/Policies → Password security → enable leaked-password protection.
5. **Verify (read-only, I can run these after you tell me rotation is done):**
   ```sql
   select email, updated_at, banned_until,
          (select count(*) from auth.sessions s where s.user_id = u.id) sessions
     from auth.users u
    where id in ('5150a545-5962-463d-b688-3370c6b55c8e','0357bef0-e75a-4142-a56b-d0749c3c6a2e','bb000000-0000-4000-8000-000000000002');
   ```
   Pass = each `updated_at` is after the rotation time (or `banned_until` is set) and sessions = 0.
6. **Then push the redaction** (`873080a`) with the rest of `feature/auto-paystub`.

Not recommended: rewriting public Git history or `schema_migrations` text. Once rotated, the old
values are useless, and both rewrites carry real risk (a force-push to a public repo, a write to
production history).

## Rollback
- Rotation: rotate again (there is no "restore old password"; use the password manager entry).
- Disable: `scripts/rotate_review_credentials.sh enable <id>`.

## Repo visibility (F4) — owner decision
Making the repo private does **not** affect the App Store legal URLs (served by GitHub Pages from
`sacredpathway/sacred-pathway-legal`; this repo has no Pages config). Private still keeps the history.
Rotation (steps 2–3) is required either way.
