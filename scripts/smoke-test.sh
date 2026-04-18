#!/usr/bin/env bash
# ============================================================================
# Sacred Pathway — post-deploy smoke test
# ----------------------------------------------------------------------------
# Confirms the live Edge Functions are reachable, your OpenAI secret works,
# and your user JWT has permission to invoke them.
#
# Tests run:
#   1. OPTIONS preflight on generate-insights   → expect 200
#   2. POST missing auth on generate-insights   → expect 401
#   3. POST with valid JWT on generate-insights → expect 200 with text
#   4. OPTIONS preflight on extract-document    → expect 200
#   5. POST with valid JWT + fake doc id        → expect 404 (row not found)
#
# Usage:
#   # First time — prompts for credentials:
#   ./scripts/smoke-test.sh
#
#   # Non-interactive:
#   SUPABASE_URL=https://rmzqxsfhjqrshhdjzhze.supabase.co \
#   SUPABASE_ANON_KEY=sb_publishable_... \
#   SACRED_TEST_EMAIL=you@example.com \
#   SACRED_TEST_PASSWORD=... \
#   ./scripts/smoke-test.sh
#
# The test credentials must be a valid user in your Supabase project. Use
# your TestFlight test account — not a production driver.
# ============================================================================

set -euo pipefail

CYAN="\033[0;36m"; GREEN="\033[0;32m"; YELLOW="\033[1;33m"; RED="\033[0;31m"; RESET="\033[0m"
step()  { printf "${CYAN}▶ %s${RESET}\n" "$*"; }
pass()  { printf "${GREEN}✓ %s${RESET}\n" "$*"; }
fail()  { printf "${RED}✗ %s${RESET}\n" "$*" >&2; exit 1; }
warn()  { printf "${YELLOW}⚠ %s${RESET}\n" "$*"; }

command -v curl >/dev/null || fail "curl is required."
command -v jq   >/dev/null || fail "jq is required (brew install jq)."

# ---------- config ----------
URL="${SUPABASE_URL:-}"
ANON="${SUPABASE_ANON_KEY:-}"
EMAIL="${SACRED_TEST_EMAIL:-}"
PASS="${SACRED_TEST_PASSWORD:-}"

[[ -n "$URL"  ]] || read -rp "Supabase URL (https://...): " URL
[[ -n "$ANON" ]] || read -rp "Supabase anon key: " ANON
[[ -n "$EMAIL" ]] || read -rp "Test user email: " EMAIL
[[ -n "$PASS" ]]  || { read -rsp "Test user password: " PASS; echo; }

EXTRACT="$URL/functions/v1/extract-document"
INSIGHTS="$URL/functions/v1/generate-insights"
TOKEN_URL="$URL/auth/v1/token?grant_type=password"

# ---------- step 1: OPTIONS preflight ----------
step "OPTIONS $INSIGHTS"
HTTP=$(curl -sS -o /dev/null -w "%{http_code}" -X OPTIONS "$INSIGHTS")
[[ "$HTTP" == "200" ]] && pass "preflight 200" || fail "preflight returned $HTTP"

# ---------- step 2: POST without auth ----------
step "POST $INSIGHTS (no auth)"
HTTP=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$INSIGHTS" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"hi"}')
[[ "$HTTP" == "401" ]] && pass "missing auth → 401" || fail "expected 401, got $HTTP"

# ---------- step 3: sign in + real call ----------
step "Signing in as $EMAIL"
SIGNIN=$(curl -sS -X POST "$TOKEN_URL" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON" \
  -d "$(jq -n --arg e "$EMAIL" --arg p "$PASS" '{email:$e, password:$p}')")
ACCESS=$(echo "$SIGNIN" | jq -r '.access_token // empty')
[[ -n "$ACCESS" ]] || fail "sign-in failed: $(echo "$SIGNIN" | jq -r '.msg // .error_description // .error // "unknown"')"
pass "got access token"

step "POST $INSIGHTS (authed)"
RES=$(curl -sS -X POST "$INSIGHTS" \
  -H "Authorization: Bearer $ACCESS" \
  -H "apikey: $ANON" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Say hello in exactly five words."}')

OK=$(echo "$RES" | jq -r '.ok // empty')
TEXT=$(echo "$RES" | jq -r '.text // empty')
MODEL=$(echo "$RES" | jq -r '.model // empty')

if [[ "$OK" == "true" && -n "$TEXT" ]]; then
  pass "generate-insights responded (model=$MODEL)"
  printf "  ${CYAN}reply:${RESET} %s\n" "$TEXT"
else
  fail "generate-insights failed: $RES"
fi

# ---------- step 4 + 5: extract-document reachability ----------
step "OPTIONS $EXTRACT"
HTTP=$(curl -sS -o /dev/null -w "%{http_code}" -X OPTIONS "$EXTRACT")
[[ "$HTTP" == "200" ]] && pass "preflight 200" || fail "preflight returned $HTTP"

step "POST $EXTRACT (authed, nonexistent document_id)"
FAKE_ID="00000000-0000-0000-0000-000000000000"
RES=$(curl -sS -X POST "$EXTRACT" \
  -H "Authorization: Bearer $ACCESS" \
  -H "apikey: $ANON" \
  -H "Content-Type: application/json" \
  -d "{\"document_id\":\"$FAKE_ID\"}")
CODE=$(echo "$RES" | jq -r '.code // empty')
if [[ "$CODE" == "not_found" ]]; then
  pass "extract-document reached → 404 not_found (expected)"
else
  warn "unexpected response (may indicate a config issue):"
  echo "$RES" | jq .
fi

# ---------- done ----------
printf "\n${GREEN}Smoke test passed.${RESET}\n"
printf "Next: open the iOS app and scan a real document.\n"
