#!/usr/bin/env bash
# =============================================================================
# OCT Image Annotator — dev runner
# =============================================================================
# Project : OCT Web Annotation Tool
# Course  : ITECH3208 – Project 1 · Federation University Australia
# Sprint  : 2 complete (Phases 4-9); Sprint 3 targets Phase 10 (S3, manual)
#
# Quick start:
#   ./run.sh            – start both servers (frontend :5173, backend :8787)
#   ./run.sh setup      – install all deps without starting servers
#   ./run.sh docs       – list Sprint docs and open paths
#
# Key docs:
#   README.md                        – setup, JSON schema, keyboard shortcuts
#   Docs/Sprint2/TechnicalReport.md  – Section C/D/E implementation report
#   Docs/Sprint2/ShowcaseSlides.md   – 10-slide presentation deck
#   Docs/Moduls.txt                  – full 45-module phase checklist
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARKERS_DIR="$ROOT_DIR/.run-cache"

hash_file() {
  local target="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$target" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$target" | awk '{print $1}'
  else
    echo "ERROR: neither sha256sum nor shasum is available"
    exit 1
  fi
}

read_marker() {
  local marker="$1"
  if [[ -f "$marker" ]]; then
    cat "$marker"
  fi
}

write_marker() {
  local marker="$1"
  local value="$2"
  mkdir -p "$MARKERS_DIR"
  printf '%s' "$value" >"$marker"
}

require_cmd() {
  local cmd_name="$1"
  local hint="$2"
  if ! command -v "$cmd_name" >/dev/null 2>&1; then
    echo "ERROR: '$cmd_name' not found. $hint"
    exit 1
  fi
}

usage() {
  cat <<'EOF'
Usage:
  ./run.sh                 Start dev servers (frontend :5173 + backend :8787)
  ./run.sh setup           Install all deps without starting servers
  ./run.sh frontend        Start Vite dev server only (frontend/)
  ./run.sh frontend:build  Lint + production build (frontend/)
  ./run.sh backend         Start API dev server only (backend/)
  ./run.sh backend:migrate Run Prisma migrate dev (backend/)
  ./run.sh py              Create venv + install requirements.txt
  ./run.sh docs            Print Sprint 2 documentation paths
  ./run.sh help            Show this message

URLs (when running):
  Frontend  →  http://localhost:5173
  Backend   →  http://localhost:8787

Key docs:
  README.md                        Setup, JSON schema, keyboard shortcuts
  Docs/Sprint2/TechnicalReport.md  Sprint 2 implementation report (Sec C/D/E)
  Docs/Sprint2/ShowcaseSlides.md   10-slide presentation deck
  Docs/Moduls.txt                  Full 45-module phase checklist
EOF
}

cmd="${1:-dev}"

setup_frontend() {
  require_cmd npm "Install Node.js and npm, then re-run."
  cd "$ROOT_DIR/frontend"
  if [[ ! -f package.json ]]; then
    echo "ERROR: frontend/package.json not found"
    exit 1
  fi

  local lock_file="$ROOT_DIR/frontend/package-lock.json"
  local marker="$MARKERS_DIR/frontend.lock.sha256"
  local hash_input="$ROOT_DIR/frontend/package.json"
  if [[ -f "$lock_file" ]]; then
    hash_input="$lock_file"
  fi
  local current_hash
  current_hash="$(hash_file "$hash_input")"
  local previous_hash
  previous_hash="$(read_marker "$marker")"

  if [[ ! -d node_modules || "$current_hash" != "$previous_hash" ]]; then
    echo "Installing frontend dependencies..."
    if [[ -f "$lock_file" ]]; then
      npm ci
    else
      npm install
    fi
    write_marker "$marker" "$current_hash"
  else
    echo "Frontend dependencies already up to date."
  fi
}

setup_backend() {
  require_cmd npm "Install Node.js and npm, then re-run."
  cd "$ROOT_DIR/backend"
  if [[ ! -f package.json ]]; then
    echo "ERROR: backend/package.json not found"
    exit 1
  fi

  local lock_file="$ROOT_DIR/backend/package-lock.json"
  local marker="$MARKERS_DIR/backend.lock.sha256"
  local hash_input="$ROOT_DIR/backend/package.json"
  if [[ -f "$lock_file" ]]; then
    hash_input="$lock_file"
  fi
  local current_hash
  current_hash="$(hash_file "$hash_input")"
  local previous_hash
  previous_hash="$(read_marker "$marker")"

  if [[ ! -d node_modules || "$current_hash" != "$previous_hash" ]]; then
    echo "Installing backend dependencies..."
    if [[ -f "$lock_file" ]]; then
      npm ci
    else
      npm install
    fi
    write_marker "$marker" "$current_hash"
  else
    echo "Backend dependencies already up to date."
  fi

  echo "Ensuring native node modules are compiled for current Node version..."
  npm rebuild


  local schema_file="$ROOT_DIR/backend/prisma/schema.prisma"
  local prisma_marker="$MARKERS_DIR/backend.prisma.schema.sha256"
  local prisma_client_file="$ROOT_DIR/backend/node_modules/.prisma/client/default.js"
  if [[ -f "$schema_file" ]]; then
    local schema_hash
    schema_hash="$(hash_file "$schema_file")"
    local prev_schema_hash
    prev_schema_hash="$(read_marker "$prisma_marker")"
    if [[ ! -f "$prisma_client_file" || "$schema_hash" != "$prev_schema_hash" ]]; then
      echo "Generating Prisma client and syncing database..."
      cd "$ROOT_DIR/backend"
      npx prisma generate --schema prisma/schema.prisma
      npx prisma db push --schema prisma/schema.prisma --accept-data-loss
      write_marker "$prisma_marker" "$schema_hash"
    else
      echo "Prisma client already up to date."
    fi
  fi
}

setup_py() {
  require_cmd python3 "Install Python 3, then re-run."
  cd "$ROOT_DIR"
  if [[ ! -f requirements.txt ]]; then
    echo "ERROR: requirements.txt not found"
    exit 1
  fi

  local marker="$MARKERS_DIR/python.requirements.sha256"
  local current_hash
  current_hash="$(hash_file "$ROOT_DIR/requirements.txt")"
  local previous_hash
  previous_hash="$(read_marker "$marker")"

  if [[ ! -d venv ]]; then
    echo "Creating python venv..."
    python3 -m venv venv
    previous_hash=""
  fi

  if [[ ! -x "$ROOT_DIR/venv/bin/python" ]]; then
    echo "ERROR: venv created but python executable is missing at venv/bin/python"
    exit 1
  fi

  if [[ "$current_hash" != "$previous_hash" ]]; then
    echo "Installing python requirements..."
    "$ROOT_DIR/venv/bin/python" -m pip install --upgrade pip
    "$ROOT_DIR/venv/bin/python" -m pip install -r requirements.txt
    write_marker "$marker" "$current_hash"
  else
    echo "Python requirements already up to date."
  fi
}

case "$cmd" in
  -h|--help|help)
    usage
    ;;
  docs)
    echo ""
    echo "  OCT Annotation Tool — Sprint 2 documentation"
    echo "  ─────────────────────────────────────────────"
    echo "  README.md                        Root setup guide + JSON schema"
    echo "  Docs/Sprint2/TechnicalReport.md  Implementation report (Sec C/D/E)"
    echo "  Docs/Sprint2/ShowcaseSlides.md   10-slide presentation deck"
    echo "  Docs/Sprint1/TechnicalReport.md  Sprint 1 report (Sec A/B)"
    echo "  Docs/Moduls.txt                  45-module phase checklist"
    echo "  Docs/RequirementsCoverage.txt    Client requirement traceability"
    echo ""
    ;;
  setup)
    setup_frontend
    setup_backend
    setup_py || true
    echo ""
    echo "  Setup complete."
    echo "  Run './run.sh' to start dev servers, or './run.sh docs' to list docs."
    echo ""
    ;;
  dev)
    setup_frontend
    setup_backend
    setup_py || true
    echo ""
    echo "  Starting OCT Annotation Tool (Sprint 2)"
    echo "  Frontend  →  http://localhost:5173"
    echo "  Backend   →  http://localhost:8787"
    echo "  Docs      →  Docs/Sprint2/TechnicalReport.md"
    echo "  Press Ctrl+C to stop both servers."
    echo ""
    (cd "$ROOT_DIR/backend" && npm run dev) &
    backend_pid=$!
    trap 'kill "$backend_pid" 2>/dev/null || true' EXIT
    cd "$ROOT_DIR/frontend"
    exec npm run dev
    ;;
  frontend)
    setup_frontend
    cd "$ROOT_DIR/frontend"
    exec npm run dev
    ;;
  frontend:build)
    setup_frontend
    cd "$ROOT_DIR/frontend"
    npm run lint
    npm run build
    ;;
  backend)
    setup_backend
    cd "$ROOT_DIR/backend"
    exec npm run dev
    ;;
  backend:migrate)
    setup_backend
    cd "$ROOT_DIR/backend"
    exec npx prisma migrate dev
    ;;
  py)
    setup_py
    ;;
  *)
    echo "Unknown command: $cmd"
    echo
    usage
    exit 2
    ;;
esac

