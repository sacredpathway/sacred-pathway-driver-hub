#!/usr/bin/env bash
# =============================================================================
#  Owner-run: rotate (or disable) an App Review / demo account password on the
#  production Supabase project through the Auth Admin API.
#
#  Secrets are NEVER passed as arguments or environment variables:
#    * the service-role key and the new password are read with `read -s`
#      (no echo, not in shell history, not visible in `ps`);
#    * they reach curl only through a mode-600 temp file that is removed on exit;
#    * nothing secret is printed. Output = HTTP status + non-secret fields.
#
#  Usage:
#    scripts/rotate_review_credentials.sh rotate  <user-id>
#    scripts/rotate_review_credentials.sh disable <user-id>   # ban (reversible)
#    scripts/rotate_review_credentials.sh enable  <user-id>   # lift the ban
#    DRY_RUN=1 scripts/rotate_review_credentials.sh rotate <user-id>
#
#  Account ids (production, read-only lookup 2026-10-25):
#    5150a545-5962-463d-b688-3370c6b55c8e  demarquishinton+appreview@gmail.com (password public on GitHub)
#    0357bef0-e75a-4142-a56b-d0749c3c6a2e  dispatcher.demo@sacredpathwaydispatch.com
#    bb000000-0000-4000-8000-000000000002  driver.demo@sacredpathwaydispatch.com
# =============================================================================
set -euo pipefail
umask 077

PROJECT_URL="https://rmzqxsfhjqrshhdjzhze.supabase.co"
ACTION="${1:-}"; USER_ID="${2:-}"
case "$ACTION" in rotate|disable|enable) ;; *) echo "usage: $0 rotate|disable|enable <user-id>" >&2; exit 2;; esac
[[ "$USER_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo "user id must be a UUID" >&2; exit 2; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

json_escape() { python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'; }

case "$ACTION" in
  rotate)
    read -r -s -p "New password (from your password manager, 16+ chars): " PW; echo
    read -r -s -p "Repeat new password: " PW2; echo
    [ "$PW" = "$PW2" ] || { echo "passwords differ" >&2; exit 1; }
    [ "${#PW}" -ge 16 ] || { echo "use 16+ characters" >&2; exit 1; }
    printf '{"password":%s}' "$(printf '%s' "$PW" | json_escape)" > "$TMP/body.json"
    unset PW PW2 ;;
  disable) printf '{"ban_duration":"876000h"}' > "$TMP/body.json" ;;
  enable)  printf '{"ban_duration":"none"}'    > "$TMP/body.json" ;;
esac

if [ -n "${DRY_RUN:-}" ]; then
  echo "DRY RUN: PUT $PROJECT_URL/auth/v1/admin/users/$USER_ID  body keys: $(python3 -c 'import json,sys; print(sorted(json.load(open(sys.argv[1]))))' "$TMP/body.json")"
  exit 0
fi

read -r -s -p "Production service-role key (Dashboard → Project Settings → API): " KEY; echo
printf 'apikey: %s\nAuthorization: Bearer %s\nContent-Type: application/json\n' "$KEY" "$KEY" > "$TMP/headers"
unset KEY

code=$(curl -sS -o "$TMP/resp.json" -w '%{http_code}' -X PUT -H @"$TMP/headers" \
  --data-binary @"$TMP/body.json" "$PROJECT_URL/auth/v1/admin/users/$USER_ID")
echo "HTTP $code"
python3 - "$TMP/resp.json" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print("non-JSON response"); sys.exit(0)
print({k: d.get(k) for k in ("id", "email", "updated_at", "banned_until", "msg", "error", "error_code") if k in d})
PY
[ "$code" = "200" ]
