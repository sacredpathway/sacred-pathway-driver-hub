#!/usr/bin/env bash
# =============================================================================
#  Owner-run: rotate (or disable / re-enable) an App Review / demo account on
#  the production Supabase project through the Auth Admin API.
#
#  Secret handling (verified by scripts/test_rotate_review_credentials.sh):
#    * the service-role key and the new password are typed at hidden prompts
#      (`IFS= read -r -s`): never arguments, never environment variables, never
#      echoed, never in shell history, never in any process's argv;
#    * they reach curl only through mode-600 files in a private temp dir that is
#      removed on exit, Ctrl-C, hang-up or error;
#    * output is the HTTP status and non-secret fields (id, email, updated_at,
#      banned_until, error code/message) only.
#
#  Diagnostics: every run appends a status log WITHOUT secrets (stage names,
#  HTTP codes, bash/curl/OS versions, account id/email) to rotation-status.log
#  next to this script (override: ROTATE_STATUS_LOG). Connectivity to Supabase
#  is checked before any prompt.
#
#  Safety: before anything is written the script reads the account by id and
#  refuses unless its email equals the email you pass, then asks you to type
#  the email again.
#
#  Usage (bash 3.2+, macOS or Linux; needs curl and python3):
#    scripts/rotate_review_credentials.sh rotate  <user-id> <expected-email>
#    scripts/rotate_review_credentials.sh disable <user-id> <expected-email>   # ban, reversible
#    scripts/rotate_review_credentials.sh enable  <user-id> <expected-email>   # lift the ban
#    DRY_RUN=1 …   -> does the read-only lookup, builds the request, sends nothing.
#
#  Account ids (production, read-only lookup 2026-10-25):
#    5150a545-5962-463d-b688-3370c6b55c8e  demarquishinton+appreview@gmail.com (password public on GitHub)
#    0357bef0-e75a-4142-a56b-d0749c3c6a2e  dispatcher.demo@sacredpathwaydispatch.com
#    bb000000-0000-4000-8000-000000000002  driver.demo@sacredpathwaydispatch.com
# =============================================================================
set -euo pipefail
umask 077

PROD_URL="https://rmzqxsfhjqrshhdjzhze.supabase.co"
PROJECT_URL="$PROD_URL"
# Test hook: only a local mock server may replace the production URL.
if [ -n "${ROTATE_TEST_URL:-}" ]; then
  case "$ROTATE_TEST_URL" in http://127.0.0.1:*) PROJECT_URL="$ROTATE_TEST_URL" ;; *) echo "ROTATE_TEST_URL must be http://127.0.0.1:<port>" >&2; exit 2 ;; esac
fi

ACTION="${1:-}"; USER_ID="${2:-}"; EXPECTED_EMAIL="${3:-}"
usage() { echo "usage: $0 rotate|disable|enable <user-id> <expected-email>" >&2; exit 2; }
case "$ACTION" in rotate|disable|enable) ;; *) usage ;; esac
[[ "$USER_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo "user id must be a lower-case UUID" >&2; exit 2; }
[[ "$EXPECTED_EMAIL" == *@* ]] || usage

# ---- status log (no secrets) and cleanup --------------------------------------
LOG="${ROTATE_STATUS_LOG:-$(cd "$(dirname "$0")" && pwd)/rotation-status.log}"
STAGE="start"
status() { printf '%s %-12s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$LOG" 2>/dev/null || true; }
TMP="$(mktemp -d)"
finish() { rc=$?; rm -rf "$TMP"; status END "rc=$rc stage=$STAGE"; }
trap finish EXIT
trap 'STAGE="$STAGE(interrupted)"; exit 130' INT TERM HUP
status START "action=$ACTION user=$USER_ID expected=$EXPECTED_EMAIL bash=${BASH_VERSION} os=$(uname -sr 2>/dev/null)"

# ---- dependencies, before any prompt (macOS: python3 needs the Command Line Tools)
STAGE="deps"
command -v curl >/dev/null 2>&1 || { status FAIL "curl not found"; echo "curl not found" >&2; exit 2; }
status DEPS "$(curl --version 2>/dev/null | head -1 | cut -c1-80)"
python3 -c 'pass' >/dev/null 2>&1 || { status FAIL "python3 not available"; echo "python3 not available (macOS: run: xcode-select --install)" >&2; exit 2; }
status DEPS "$(python3 -V 2>&1)"

# ---- connectivity, before any prompt ------------------------------------------
STAGE="connectivity"
net_code=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' "$PROJECT_URL/auth/v1/health" 2>"$TMP/neterr" || true)
status NET "GET /auth/v1/health -> HTTP ${net_code:-none} $(tr '\n' ' ' < "$TMP/neterr" | cut -c1-160)"
case "$net_code" in
  200|401) ;;
  *) echo "Cannot reach Supabase (HTTP ${net_code:-none}): $(tr '\n' ' ' < "$TMP/neterr")" >&2
     echo "Check your internet/VPN, then run the same command again. Nothing was sent." >&2; exit 3 ;;
esac

# ---- service-role key --------------------------------------------------------
STAGE="key"
IFS= read -r -s -p "Production service-role key (Dashboard → Project Settings → API Keys): " KEY; echo
[ -n "$KEY" ] || { status FAIL "no key entered"; echo "no key entered" >&2; exit 1; }
# Clean and classify the key without printing it. Keys never contain whitespace,
# quotes or control characters, so stripping those (e.g. a trailing newline, the
# invisible bracketed-paste markers ESC[200~ / ESC[201~, or quotes copied with the
# value) cannot change a valid key. Only the key's SHAPE is reported, never content.
printf '%s' "$KEY" > "$TMP/rawkey"
unset KEY
python3 - "$TMP/rawkey" "$TMP/key" "$TMP/keyinfo" <<'PY'
import sys, json, base64, re
raw = open(sys.argv[1], "rb").read().decode("utf-8", "replace")
had_ws = any(c.isspace() for c in raw)
had_ctl = any(ord(c) < 32 or ord(c) == 127 for c in raw if not c.isspace())
k = re.sub(r"(\x1b)?\[20[01]~", "", raw)                      # bracketed-paste markers
k = "".join(c for c in k if not c.isspace() and ord(c) >= 32 and ord(c) != 127)
k = k.strip("'\"`")
fam = ("jwt" if k.startswith("eyJ") else "sb_secret" if k.startswith("sb_secret_")
       else "sb_publishable" if k.startswith("sb_publishable_") else "sbp_token" if k.startswith("sbp_") else "other")
kind, why = "unknown", ""
if fam == "sb_secret":
    kind = "secret"
elif fam == "sb_publishable":
    kind = "publishable"
elif fam == "jwt":
    parts = k.split(".")
    if len(parts) != 3:
        why = f"JWT with {len(parts)} segments (copy cut off?)"
    else:
        try:
            p = parts[1] + "=" * (-len(parts[1]) % 4)
            kind = json.loads(base64.urlsafe_b64decode(p)).get("role") or "unknown"
            if kind == "unknown":
                why = "JWT without a role"
        except Exception:
            why = "JWT payload unreadable (copy cut off?)"
elif fam == "sbp_token":
    why = "this is a Supabase personal access token, not the project's service-role key"
else:
    why = ("looks like the JWT signing secret or a password, not an API key" if "." not in k
           else "unrecognised format")
open(sys.argv[2], "w").write(k)
shape = f"len={len(k)} segments={k.count('.') + 1} family={fam} cleaned_whitespace={had_ws} cleaned_control_chars={had_ctl}"
open(sys.argv[3], "w").write(json.dumps({"kind": kind, "why": why, "shape": shape}))
PY
rm -f "$TMP/rawkey"
KIND="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["kind"])' "$TMP/keyinfo")"
KEY_WHY="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["why"])' "$TMP/keyinfo")"
KEY_SHAPE="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["shape"])' "$TMP/keyinfo")"
status KEY "kind=$KIND $KEY_SHAPE ${KEY_WHY:+why=$KEY_WHY}"
case "$KIND" in
  secret)       python3 - "$TMP/key" "$TMP/headers" <<'PY'
import sys; k = open(sys.argv[1]).read()
open(sys.argv[2], "w").write(f"apikey: {k}\nContent-Type: application/json\n")
PY
                ;;
  service_role) python3 - "$TMP/key" "$TMP/headers" <<'PY'
import sys; k = open(sys.argv[1]).read()
open(sys.argv[2], "w").write(f"apikey: {k}\nAuthorization: Bearer {k}\nContent-Type: application/json\n")
PY
                ;;
  *) rm -f "$TMP/key"
     echo "That is not the production service-role key (detected: $KIND${KEY_WHY:+ - $KEY_WHY}). Nothing was sent." >&2
     echo "Use: Supabase Dashboard -> project rmzqxsfhjqrshhdjzhze -> Project Settings -> API Keys ->" >&2
     echo "     'Secret keys' (sb_secret_...) or 'Legacy API keys' -> service_role (Reveal, then Copy)." >&2
     exit 1 ;;
esac
rm -f "$TMP/key"

fields() {  # print only non-secret fields of a GoTrue user / error JSON
  python3 - "$1" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print("non-JSON response"); sys.exit(0)
keep = ("id", "email", "updated_at", "banned_until", "last_sign_in_at", "code", "error_code", "msg", "message", "error")
print({k: d.get(k) for k in keep if k in d})
PY
}

# ---- 1. read-only identity check --------------------------------------------
STAGE="lookup"
code=$(curl -sS -o "$TMP/user.json" -w '%{http_code}' -H @"$TMP/headers" "$PROJECT_URL/auth/v1/admin/users/$USER_ID" 2>"$TMP/neterr" || true)
status LOOKUP "HTTP ${code:-none} $(fields "$TMP/user.json" 2>/dev/null | cut -c1-200) $(tr '\n' ' ' < "$TMP/neterr" | cut -c1-120)"
if [ "$code" != "200" ]; then echo "lookup failed: HTTP ${code:-none} $(tr '\n' ' ' < "$TMP/neterr")"; fields "$TMP/user.json"; exit 1; fi
ACTUAL_EMAIL="$(python3 -c 'import json,sys; print((json.load(open(sys.argv[1])).get("email") or "").lower())' "$TMP/user.json")"
EXP_LC="$(printf '%s' "$EXPECTED_EMAIL" | tr '[:upper:]' '[:lower:]')"
STAGE="identity"
if [ "$ACTUAL_EMAIL" != "$EXP_LC" ]; then
  status FAIL "identity mismatch: account email <$ACTUAL_EMAIL>"
  echo "REFUSED: account $USER_ID belongs to <$ACTUAL_EMAIL>, not <$EXP_LC>. Nothing changed." >&2; exit 1
fi
echo "Target: $USER_ID <$ACTUAL_EMAIL>  action: $ACTION"
status IDENTITY "match <$ACTUAL_EMAIL>"
STAGE="confirm"
IFS= read -r -p "Type the email again to confirm: " CONFIRM
[ "$(printf '%s' "$CONFIRM" | tr '[:upper:]' '[:lower:]')" = "$ACTUAL_EMAIL" ] || { status FAIL "confirmation did not match"; echo "not confirmed; nothing changed" >&2; exit 1; }
STAGE="body"

# ---- 2. request body ---------------------------------------------------------
case "$ACTION" in
  rotate)
    IFS= read -r -s -p "New password (from your password manager, 16+ chars): " PW; echo
    IFS= read -r -s -p "Repeat new password: " PW2; echo
    [ "$PW" = "$PW2" ] || { unset PW PW2; status FAIL "passwords differ"; echo "passwords differ; nothing changed" >&2; exit 1; }
    [ "${#PW}" -ge 16 ] || { unset PW PW2; status FAIL "password shorter than 16"; echo "use 16+ characters; nothing changed" >&2; exit 1; }
    case "$PW" in *[[:cntrl:]]*) unset PW PW2; status FAIL "password contains terminal control characters (paste markers?)"; echo "the password contains invisible control characters (terminal paste markers?); type or paste it again. Nothing changed." >&2; exit 1 ;; esac
    printf '%s' "$PW" | python3 -c 'import json,sys; sys.stdout.write(json.dumps({"password": sys.stdin.read()}))' > "$TMP/body.json"
    unset PW PW2 ;;
  disable) printf '{"ban_duration":"876000h"}' > "$TMP/body.json" ;;
  enable)  printf '{"ban_duration":"none"}'    > "$TMP/body.json" ;;
esac

status BODY "keys=$(python3 -c 'import json,sys; print(sorted(json.load(open(sys.argv[1]))))' "$TMP/body.json")"
if [ -n "${DRY_RUN:-}" ]; then
  STAGE="dry-run"
  echo "DRY RUN: would PUT $PROJECT_URL/auth/v1/admin/users/$USER_ID  body keys: $(python3 -c 'import json,sys; print(sorted(json.load(open(sys.argv[1]))))' "$TMP/body.json"). Nothing sent."
  exit 0
fi

# ---- 3. write ---------------------------------------------------------------
STAGE="write"
code=$(curl -sS -o "$TMP/resp.json" -w '%{http_code}' -X PUT -H @"$TMP/headers" \
  --data-binary @"$TMP/body.json" "$PROJECT_URL/auth/v1/admin/users/$USER_ID" 2>"$TMP/neterr" || true)
status WRITE "HTTP ${code:-none} $(fields "$TMP/resp.json" 2>/dev/null | cut -c1-200) $(tr '\n' ' ' < "$TMP/neterr" | cut -c1-120)"
echo "HTTP ${code:-none}"
fields "$TMP/resp.json"
[ "$code" = "200" ] || exit 1
STAGE="done"
echo "Done. Next: update the same password in App Store Connect if this account is a review sign-in, then clear your clipboard."
