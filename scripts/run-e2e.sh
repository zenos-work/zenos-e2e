#!/usr/bin/env bash
# =============================================================================
# run-e2e.sh — Zenos E2E Test Runner
#
# Usage:
#   ./scripts/run-e2e.sh [options]
#
# Options:
#   --ci [max-tests]   CI mode: skip interactive sign-in, use env-var tokens.
#                      Optional number limits run to first N collected tests.
#   --headed           Run tests in headed (visible browser) mode
#   --suite <name>     Run a specific suite: smoke | auth | articles | social |
#                      comments | workflow | admin | reading | ui | api |
#                      membership | notifications | series | profile | full
#   --tag <tag>        Run tests matching a @tag  (e.g. --tag @smoke)
#   --report           Open the HTML report after tests
#   --skip-start       Skip starting backend/frontend (use if already running)
#   --role-projects    Enable role-isolated Playwright projects
#   --project <name>   Run a specific Playwright project
#   --help             Show this help
#
# Environment variables (for CI mode):
#   TEST_ACCESS_TOKEN        Optional regular user access token override
#   TEST_REFRESH_TOKEN       Optional regular user refresh token override
#   TEST_ADMIN_ACCESS_TOKEN  Optional admin user access token override
#   TEST_ADMIN_REFRESH_TOKEN Optional admin user refresh token override
#   E2E_TEST_AUTH_SECRET     Optional shared secret for /auth/test/token
#   FRONTEND_URL             Default: http://localhost:5173
#   VITE_API_BASE_URL        Default: http://127.0.0.1:8787
#   STRICT_SKIP_GATE         true/false (default: true in CI mode, false otherwise)
#   MAX_SKIPPED_TESTS        Max allowed skipped tests when strict gate is enabled
#                            (default: 0)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
E2E_DIR="${E2E_ROOT}/e2e"
ZENOS_ROOT="$(cd "${E2E_ROOT}/.." && pwd)"
BACKEND_DIR="${ZENOS_ROOT}/zenos-backend"
DB_DIR="${ZENOS_ROOT}/zenos-db"

# ── Defaults ─────────────────────────────────────────────────────────────────
CI_MODE=false
HEADED=false
SUITE=""
TAG_FILTER=""
OPEN_REPORT=false
SKIP_START=false
ROLE_PROJECTS=false
PROJECT_NAME=""
MAX_TESTS=""
RUN_TS="$(date +%Y%m%d-%H%M%S)"
LOG_DIR="${E2E_ROOT}/.local-dev/e2e-logs"
RUN_LOG="${LOG_DIR}/run-${RUN_TS}.log"
ERROR_LOG="${LOG_DIR}/run-${RUN_TS}.error.log"

# ── Parse arguments ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ci)
      CI_MODE=true
      if [[ $# -gt 1 && "$2" =~ ^[0-9]+$ ]]; then
        MAX_TESTS="$2"
        shift 2
      else
        shift
      fi
      ;;
    --headed)       HEADED=true; shift ;;
    --suite)        SUITE="$2"; shift 2 ;;
    --tag)          TAG_FILTER="$2"; shift 2 ;;
    --report)       OPEN_REPORT=true; shift ;;
    --skip-start)   SKIP_START=true; shift ;;
    --role-projects) ROLE_PROJECTS=true; shift ;;
    --project)      PROJECT_NAME="$2"; shift 2 ;;
    --help)
      head -40 "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# ── Validate e2e directory ────────────────────────────────────────────────────
if [[ ! -f "${E2E_DIR}/package.json" ]]; then
  echo "❌  e2e directory not found at: ${E2E_DIR}"
  echo "    Run: cd zenos-e2e/e2e && npm install"
  exit 1
fi

if [[ ! -f "${BACKEND_DIR}/wrangler.jsonc" ]]; then
  echo "❌  backend config not found at: ${BACKEND_DIR}/wrangler.jsonc"
  exit 1
fi

# ── Clean up stale auth state for fresh start ─────────────────────────────────
AUTH_DIR="${E2E_DIR}/.auth"
if [[ -d "${AUTH_DIR}" ]]; then
  echo "🧹  Removing stale auth state: ${AUTH_DIR}"
  rm -rf "${AUTH_DIR}"
fi
mkdir -p "${AUTH_DIR}"
echo "✅  Fresh auth directory ready"

# ── Export env vars ───────────────────────────────────────────────────────────
export FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-http://127.0.0.1:8787}"

[[ "$CI_MODE"    == "true" ]] && export CI=true
[[ "$SKIP_START" == "true" ]] && export SKIP_SERVICE_START=true
[[ "$ROLE_PROJECTS" == "true" ]] && export E2E_ENABLE_ROLE_PROJECTS=true

if [[ "$CI_MODE" == "true" ]]; then
  export E2E_TEST_AUTH_ENABLED=true
  if [[ -z "${E2E_TEST_AUTH_SECRET:-}" ]]; then
    E2E_TEST_AUTH_SECRET="e2e-$(date +%s)-$(od -vAn -N8 -tx1 /dev/urandom | tr -d ' \n')"
    export E2E_TEST_AUTH_SECRET
  fi
fi

if [[ -z "${STRICT_SKIP_GATE:-}" ]]; then
  if [[ "$CI_MODE" == "true" ]]; then
    STRICT_SKIP_GATE=true
  else
    STRICT_SKIP_GATE=false
  fi
fi

MAX_SKIPPED_TESTS="${MAX_SKIPPED_TESTS:-0}"
if [[ "$STRICT_SKIP_GATE" == "true" ]] && ! [[ "$MAX_SKIPPED_TESTS" =~ ^[0-9]+$ ]]; then
  echo "❌  MAX_SKIPPED_TESTS must be a non-negative integer (got: ${MAX_SKIPPED_TESTS})"
  exit 1
fi

# ── Build playwright command ──────────────────────────────────────────────────
PW_CMD="npx playwright test"

if [[ -n "$SUITE" ]]; then
  case "$SUITE" in
    smoke)     PW_CMD="$PW_CMD --grep @smoke" ;;
    auth)      PW_CMD="$PW_CMD tests/00-auth/" ;;
    notifications) PW_CMD="$PW_CMD tests/10-notifications/" ;;
    articles)  PW_CMD="$PW_CMD tests/02-articles/" ;;
    social)    PW_CMD="$PW_CMD tests/03-social/" ;;
    comments)  PW_CMD="$PW_CMD tests/04-comments/" ;;
    workflow)  PW_CMD="$PW_CMD tests/05-workflow/" ;;
    admin)     PW_CMD="$PW_CMD tests/06-admin/" ;;
    reading)   PW_CMD="$PW_CMD tests/07-reading/" ;;
    ui)        PW_CMD="$PW_CMD tests/08-ui/" ;;
    membership) PW_CMD="$PW_CMD tests/09-api/api-membership.spec.ts" ;;
    api)       PW_CMD="$PW_CMD tests/09-api/" ;;
    series)    PW_CMD="$PW_CMD tests/11-series/" ;;
    profile)   PW_CMD="$PW_CMD tests/12-profile/" ;;
    full)      : ;; # run everything
    *)
      echo "❌  Unknown suite: $SUITE"
      echo "    Valid suites: smoke auth notifications articles social comments workflow admin reading ui membership api series profile full"
      exit 1
      ;;
  esac
fi

[[ -n "$TAG_FILTER" ]] && PW_CMD="$PW_CMD --grep '${TAG_FILTER}'"
[[ "$HEADED" == "true" ]]  && PW_CMD="$PW_CMD --headed"
[[ -n "$PROJECT_NAME" ]] && PW_CMD="$PW_CMD --project '${PROJECT_NAME}'"

# ── Print config summary ──────────────────────────────────────────────────────
mkdir -p "${LOG_DIR}"
touch "${RUN_LOG}" "${ERROR_LOG}"

if [[ -n "${MAX_TESTS}" ]]; then
  if [[ "${MAX_TESTS}" -le 0 ]]; then
    echo "❌  Invalid max-tests value after --ci: ${MAX_TESTS}"
    echo "    Provide a positive integer, e.g. --ci 25"
    exit 1
  fi

  TEST_LIST_FILE="${LOG_DIR}/test-list-${RUN_TS}.txt"
  TEST_LIST_ALL="${TEST_LIST_FILE}.all"

  echo "📋  Collecting tests and limiting run to first ${MAX_TESTS}..."
  (cd "${E2E_DIR}" && eval "${PW_CMD} --list") > "${TEST_LIST_ALL}"
  grep '›' "${TEST_LIST_ALL}" | head -n "${MAX_TESTS}" > "${TEST_LIST_FILE}"

  if [[ ! -s "${TEST_LIST_FILE}" ]]; then
    echo "❌  Could not build a limited test list from playwright --list output"
    exit 1
  fi

  PW_CMD="${PW_CMD} --test-list '${TEST_LIST_FILE}'"
fi

echo ""
echo "┌─────────────────────────────────────────────────┐"
echo "│  Zenos E2E Test Runner                          │"
echo "├─────────────────────────────────────────────────┤"
printf "│  Frontend:    %-34s │\n" "$FRONTEND_URL"
printf "│  Backend:     %-34s │\n" "$VITE_API_BASE_URL"
printf "│  CI mode:     %-34s │\n" "$CI_MODE"
printf "│  Headed:      %-34s │\n" "$HEADED"
printf "│  Suite:       %-34s │\n" "${SUITE:-all}"
printf "│  Max tests:   %-34s │\n" "${MAX_TESTS:-none}"
printf "│  Skip start:  %-34s │\n" "$SKIP_START"
printf "│  Role suites: %-34s │\n" "$ROLE_PROJECTS"
printf "│  Project:     %-34s │\n" "${PROJECT_NAME:-all}"
printf "│  Run log:     %-34s │\n" "${RUN_LOG#${E2E_ROOT}/}"
printf "│  Error log:   %-34s │\n" "${ERROR_LOG#${E2E_ROOT}/}"
echo "└─────────────────────────────────────────────────┘"
echo ""

# ── Install npm dependencies if needed ───────────────────────────────────────
if [[ ! -d "${E2E_DIR}/node_modules/@playwright" ]]; then
  echo "📦  Installing e2e npm dependencies..."
  (cd "${E2E_DIR}" && npm install)
fi

# ── Install browsers if needed ────────────────────────────────────────────────
if [[ ! -d "${HOME}/.cache/ms-playwright" ]]; then
  echo "🔧  Installing Playwright browsers..."
  (cd "${E2E_DIR}" && npx playwright install --with-deps chromium)
fi

# ── Preflight: clear stale local backend listener (localhost:8787) ──────────
if [[ "${SKIP_START}" != "true" ]]; then
  EXISTING_BACKEND_PID="$(ss -ltnp 2>/dev/null | awk '/127\.0\.0\.1:8787|\[::1\]:8787|\*:8787/ { if (match($0, /pid=[0-9]+/)) { print substr($0, RSTART+4, RLENGTH-4); exit } }')"
  if [[ -n "${EXISTING_BACKEND_PID}" ]]; then
    EXISTING_BACKEND_CMD="$(ps -p "${EXISTING_BACKEND_PID}" -o args= 2>/dev/null || true)"
    if [[ "${EXISTING_BACKEND_CMD}" == *"workerd"* ]]; then
      echo "⚠️   Found stale backend listener on 8787 (pid ${EXISTING_BACKEND_PID}); stopping it..."
      kill "${EXISTING_BACKEND_PID}" 2>/dev/null || true
      sleep 1
      if ss -ltnp 2>/dev/null | grep -qE '127\.0\.0\.1:8787|\[::1\]:8787|\*:8787'; then
        kill -9 "${EXISTING_BACKEND_PID}" 2>/dev/null || true
      fi
    else
      echo "❌  Port 8787 is already in use by pid ${EXISTING_BACKEND_PID}."
      echo "    Command: ${EXISTING_BACKEND_CMD}"
      echo "    Stop that process or run with a different VITE_API_BASE_URL port."
      exit 1
    fi
  fi
fi

# ── Ensure local DB schema has required feature migrations ───────────────────
if [[ -d "${DB_DIR}" ]]; then
  echo "🗄️   Validating local D1 schema (reading + series + membership + citations)..."

  run_local_sql() {
    local sql="$1"
    (cd "${DB_DIR}" && npx wrangler d1 execute prd-zenos-blog-db --local --config "${BACKEND_DIR}/wrangler.jsonc" --command "${sql}" 2>/dev/null || true)
  }

  apply_local_migration() {
    local migration_file="$1"
    echo "🛠️   Applying migration ${migration_file}..."
    (cd "${DB_DIR}" && npx wrangler d1 execute prd-zenos-blog-db --local --config "${BACKEND_DIR}/wrangler.jsonc" --file "migrations/${migration_file}")
  }

  ARTICLE_INFO_OUTPUT="$(run_local_sql "PRAGMA table_info(articles);")"
  USER_INFO_OUTPUT="$(run_local_sql "PRAGMA table_info(users);")"
  TABLES_OUTPUT="$(run_local_sql "SELECT name FROM sqlite_master WHERE type='table';")"

  if ! grep -q '"name": "reading_level"' <<<"${ARTICLE_INFO_OUTPUT}"; then
    apply_local_migration "0020_article_reading_level.sql"
    ARTICLE_INFO_OUTPUT="$(run_local_sql "PRAGMA table_info(articles);")"
  else
    echo "✅  Local schema already includes articles.reading_level"
  fi

  if ! grep -q '"series"' <<<"${TABLES_OUTPUT}" || ! grep -q '"article_series"' <<<"${TABLES_OUTPUT}"; then
    apply_local_migration "0026_series_model.sql"
    TABLES_OUTPUT="$(run_local_sql "SELECT name FROM sqlite_master WHERE type='table';")"
  else
    echo "✅  Local schema already includes series tables"
  fi

  if ! grep -q '"name": "membership_tier"' <<<"${USER_INFO_OUTPUT}" || \
     ! grep -q '"name": "premium_only"' <<<"${ARTICLE_INFO_OUTPUT}" || \
     ! grep -q '"membership_plans"' <<<"${TABLES_OUTPUT}" || \
     ! grep -q '"premium_funnel_events"' <<<"${TABLES_OUTPUT}"; then
    apply_local_migration "0027_phase3_membership_and_premium.sql"
    ARTICLE_INFO_OUTPUT="$(run_local_sql "PRAGMA table_info(articles);")"
  else
    echo "✅  Local schema already includes membership/premium tables and columns"
  fi

  if ! grep -q '"name": "citations"' <<<"${ARTICLE_INFO_OUTPUT}"; then
    apply_local_migration "0039_article_citations.sql"
  else
    echo "✅  Local schema already includes articles.citations"
  fi
fi

# ── Run tests ──────────────────────────────────────────────────────────────────
echo "🚀  Running: $PW_CMD"
echo ""

cd "${E2E_DIR}"
EXIT_CODE=0
SKIPPED_COUNT=0
ERROR_PATTERN='(^\s*✘\s+[0-9]+)|(^\s*Error: )|((POST|GET|PUT|PATCH|DELETE) /api/.* failed: )|(INTERNAL_ERROR)|(SQLITE_ERROR)|(Failed to fetch)'

# Stream output through two parallel greps so both log files are written
# in real-time — tail -f on either file works during the run.
#   tee + process substitution  → error lines flow into ERROR_LOG live
#   final grep -vE              → non-error lines flow into RUN_LOG live
# set +e/-e wraps the pipeline so pipefail doesn't swallow playwright's exit code.
set +e
eval "$PW_CMD" 2>&1 \
  | tee >(grep --line-buffered -E  "${ERROR_PATTERN}" >> "${ERROR_LOG}") \
  | grep --line-buffered -vE "${ERROR_PATTERN}" >> "${RUN_LOG}"
EXIT_CODE="${PIPESTATUS[0]}"
set -e

RESULTS_JSON="${E2E_DIR}/playwright-report/results.json"
if [[ -f "${RESULTS_JSON}" ]]; then
  if command -v jq >/dev/null 2>&1; then
    SKIPPED_COUNT="$(jq -r '.stats.skipped // 0' "${RESULTS_JSON}" 2>/dev/null || echo 0)"
  else
    SKIPPED_COUNT="$(node -e "const fs=require('fs');const p='${RESULTS_JSON}';try{const j=JSON.parse(fs.readFileSync(p,'utf8'));console.log((j.stats&&typeof j.stats.skipped==='number')?j.stats.skipped:0);}catch{console.log(0);}")"
  fi
fi

# ── Report ────────────────────────────────────────────────────────────────────
echo ""
if [[ $EXIT_CODE -eq 0 ]]; then
  echo "✅  All tests passed!"
else
  echo "❌  Tests failed (exit code: $EXIT_CODE)"
fi
echo "⏭️   Skipped:     ${SKIPPED_COUNT}"

if [[ "$STRICT_SKIP_GATE" == "true" ]] && [[ "${SKIPPED_COUNT}" -gt "${MAX_SKIPPED_TESTS}" ]]; then
  echo "❌  Strict quality gate failed: skipped tests (${SKIPPED_COUNT}) exceed MAX_SKIPPED_TESTS (${MAX_SKIPPED_TESTS})"
  EXIT_CODE=1
fi

echo "📝  Clean log:   ${RUN_LOG}"
if [[ -s "${ERROR_LOG}" ]]; then
  echo "⚠️   Error log:   ${ERROR_LOG}"
else
  echo "ℹ️   No errors captured"
fi

if [[ "$OPEN_REPORT" == "true" ]]; then
  echo "📊  Opening HTML report..."
  npx playwright show-report
fi

exit $EXIT_CODE
