#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ZENOS_ROOT="$(cd "$E2E_DIR/.." && pwd)"

BACKEND_DIR="$ZENOS_ROOT/zenos-backend"
FRONTEND_DIR="$ZENOS_ROOT/zenos-frontend"
DB_DIR="$ZENOS_ROOT/zenos-db"
LOCAL_RUN_DIR="$E2E_DIR/.local-dev"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
}

prompt_required() {
  local prompt="$1"
  local var_name="$2"
  local secret="${3:-false}"
  local value=""

  while [[ -z "$value" ]]; do
    if [[ "$secret" == "true" ]]; then
      read -r -s -p "$prompt: " value
      echo
    else
      read -r -p "$prompt: " value
    fi
  done

  printf -v "$var_name" '%s' "$value"
}

prompt_default() {
  local prompt="$1"
  local default_value="$2"
  local var_name="$3"
  local value=""

  read -r -p "$prompt [$default_value]: " value
  value="${value:-$default_value}"
  printf -v "$var_name" '%s' "$value"
}

write_backend_env() {
  local google_client_id="$1"
  local jwt_secret="$2"
  local frontend_url="$3"

  cat > "$BACKEND_DIR/.env" <<EOF
ENVIRONMENT=development
FRONTEND_URL=$frontend_url
GOOGLE_CLIENT_ID=$google_client_id
JWT_SECRET=$jwt_secret
EOF
}

write_frontend_env() {
  local api_base_url="$1"
  cat > "$FRONTEND_DIR/.env.local" <<EOF
VITE_API_BASE_URL=$api_base_url
EOF
}

install_deps() {
  echo "Installing backend dependencies..."
  (
    cd "$BACKEND_DIR"
    uv sync --extra dev
    npm ci
  )

  echo "Installing frontend dependencies..."
  (
    cd "$FRONTEND_DIR"
    pnpm install --frozen-lockfile
  )

  if [[ -f "$DB_DIR/package.json" ]]; then
    echo "Installing db tool dependencies..."
    (
      cd "$DB_DIR"
      npm ci
    )
  fi
}

start_services() {
  mkdir -p "$LOCAL_RUN_DIR"

  echo "Starting backend (wrangler dev --env dev)..."
  (
    cd "$BACKEND_DIR"
    npx wrangler dev --env dev > "$LOCAL_RUN_DIR/backend.log" 2>&1
  ) &
  BACKEND_PID=$!

  echo "Starting frontend (pnpm dev --host)..."
  (
    cd "$FRONTEND_DIR"
    pnpm dev --host > "$LOCAL_RUN_DIR/frontend.log" 2>&1
  ) &
  FRONTEND_PID=$!

  cat > "$LOCAL_RUN_DIR/pids" <<EOF
BACKEND_PID=$BACKEND_PID
FRONTEND_PID=$FRONTEND_PID
EOF

  echo
  echo "Services started."
  echo "- Backend log:  $LOCAL_RUN_DIR/backend.log"
  echo "- Frontend log: $LOCAL_RUN_DIR/frontend.log"
  echo "- PID file:     $LOCAL_RUN_DIR/pids"
  echo
  echo "Stop services with:"
  echo "  kill $BACKEND_PID $FRONTEND_PID"
}

main() {
  require_cmd uv
  require_cmd node
  require_cmd npm
  require_cmd pnpm
  require_cmd npx

  if [[ ! -d "$BACKEND_DIR" || ! -d "$FRONTEND_DIR" || ! -d "$DB_DIR" ]]; then
    echo "Expected sibling repos zenos-backend, zenos-frontend, zenos-db next to zenos-e2e."
    exit 1
  fi

  echo "Zenos local setup"
  echo "E2E repo:      $E2E_DIR"
  echo "Workspace root: $ZENOS_ROOT"
  echo

  prompt_required "Google OAuth Client ID" GOOGLE_CLIENT_ID false
  prompt_required "JWT secret" JWT_SECRET true
  prompt_default "Backend URL for frontend" "http://localhost:8787" API_BASE_URL
  prompt_default "Frontend URL for backend CORS" "http://localhost:5173" FRONTEND_URL

  write_backend_env "$GOOGLE_CLIENT_ID" "$JWT_SECRET" "$FRONTEND_URL"
  write_frontend_env "$API_BASE_URL"

  echo "Wrote $BACKEND_DIR/.env"
  echo "Wrote $FRONTEND_DIR/.env.local"

  prompt_default "Install dependencies now? (y/n)" "y" INSTALL_NOW
  if [[ "$INSTALL_NOW" =~ ^[Yy]$ ]]; then
    install_deps
  fi

  prompt_default "Start backend + frontend now? (y/n)" "n" START_NOW
  if [[ "$START_NOW" =~ ^[Yy]$ ]]; then
    start_services
  else
    echo "Setup complete."
    echo "Run manually:"
    echo "  cd $BACKEND_DIR && npx wrangler dev --env dev"
    echo "  cd $FRONTEND_DIR && pnpm dev --host"
  fi
}

main "$@"
