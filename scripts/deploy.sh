#!/usr/bin/env bash
# ============================================================================
# Sacred Pathway — one-command Supabase deploy
# ----------------------------------------------------------------------------
# Chains: supabase link → secrets set → db push → functions deploy.
#
# Usage:
#   # First time (prompts for the OpenAI key, no arguments needed):
#   ./scripts/deploy.sh
#
#   # Non-interactive (CI, re-deploy):
#   SUPABASE_PROJECT_REF=rmzqxsfhjqrshhdjzhze \
#   OPENAI_API_KEY=sk-... \
#   ./scripts/deploy.sh
#
#   # Skip secrets/migration, just redeploy functions:
#   ./scripts/deploy.sh --functions-only
#
# Prereqs: `supabase` CLI on PATH, logged in via `supabase login`.
# ============================================================================

set -euo pipefail

# ---------- paths ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ---------- pretty printing ----------
CYAN="\033[0;36m"; GREEN="\033[0;32m"; YELLOW="\033[1;33m"; RED="\033[0;31m"; RESET="\033[0m"
step()  { printf "${CYAN}▶ %s${RESET}\n" "$*"; }
ok()    { printf "${GREEN}✓ %s${RESET}\n" "$*"; }
warn()  { printf "${YELLOW}⚠ %s${RESET}\n" "$*"; }
die()   { printf "${RED}✗ %s${RESET}\n" "$*" >&2; exit 1; }

# ---------- flags ----------
FUNCTIONS_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --functions-only) FUNCTIONS_ONLY=true ;;
    -h|--help)
      sed -n '3,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "Unknown flag: $arg" ;;
  esac
done

# ---------- preflight ----------
command -v supabase >/dev/null 2>&1 \
  || die "supabase CLI not found. Install with: brew install supabase/tap/supabase"

# Resolve project ref: env var > existing .supabase/project-ref > prompt.
PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
if [[ -z "$PROJECT_REF" && -f .supabase/project-ref ]]; then
  PROJECT_REF="$(cat .supabase/project-ref)"
fi
if [[ -z "$PROJECT_REF" ]]; then
  read -rp "Supabase project ref (e.g. rmzqxsfhjqrshhdjzhze): " PROJECT_REF
  [[ -n "$PROJECT_REF" ]] || die "Project ref is required."
fi

# ---------- step 1: link ----------
step "Linking to Supabase project: $PROJECT_REF"
supabase link --project-ref "$PROJECT_REF" >/dev/null
ok "Linked."

if $FUNCTIONS_ONLY; then
  warn "--functions-only: skipping secrets + migrations."
else
  # -------- step 2: secrets --------
  step "Setting Edge Function secrets"
  KEY="${OPENAI_API_KEY:-}"
  if [[ -z "$KEY" ]]; then
    read -rsp "Paste your OpenAI API key (starts with sk-): " KEY
    echo
  fi
  [[ -n "$KEY" ]] || die "OPENAI_API_KEY is required."
  [[ "$KEY" == sk-* ]] || warn "Key doesn't start with 'sk-'. Continuing anyway."

  supabase secrets set \
    "OPENAI_API_KEY=$KEY" \
    "OPENAI_VISION_MODEL=${OPENAI_VISION_MODEL:-gpt-4o}" \
    "OPENAI_TEXT_MODEL=${OPENAI_TEXT_MODEL:-gpt-4o-mini}" \
    >/dev/null
  ok "Secrets set (OPENAI_API_KEY, OPENAI_VISION_MODEL, OPENAI_TEXT_MODEL)."

  # -------- step 3: migration --------
  step "Applying database migrations"
  supabase db push
  ok "Migrations applied."
fi

# -------- step 4: deploy functions --------
step "Deploying extract-document"
supabase functions deploy extract-document
ok "extract-document deployed."

step "Deploying generate-insights"
supabase functions deploy generate-insights
ok "generate-insights deployed."

# -------- done --------
printf "\n${GREEN}All done.${RESET}\n"
printf "Run a smoke test:  ./scripts/smoke-test.sh\n"
printf "Tail function logs: supabase functions logs extract-document --tail\n"
