#!/usr/bin/env bash
# ── E2E Test Runner (Linux/Mac) ───────────────────────────────────────────────
# Usage:
#   ./scripts/run_e2e.sh [--stop-after] [--base http://localhost:8000] [--timeout 120]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE_URL="http://localhost:8000"
STOP_AFTER=0
LLM_TIMEOUT=120

while [[ $# -gt 0 ]]; do
  case $1 in
    --stop-after) STOP_AFTER=1 ;;
    --base)       BASE_URL="$2"; shift ;;
    --timeout)    LLM_TIMEOUT="$2"; shift ;;
  esac
  shift
done

echo ""
echo "========================================"
echo "  RAG Teaching Material — E2E Test Run  "
echo "========================================"
echo ""

# 1. Start backend
echo "[1/4] Starting backend container..."
cd "$ROOT"
docker compose up -d backend

# 2. Wait for healthy
echo ""
echo "[2/4] Waiting for backend at $BASE_URL/health ..."
MAX_WAIT=120
ELAPSED=0
until curl -sf "$BASE_URL/health" > /dev/null 2>&1; do
  sleep 3
  ELAPSED=$((ELAPSED + 3))
  echo "   ...waiting (${ELAPSED}s / ${MAX_WAIT}s)"
  if [[ $ELAPSED -ge $MAX_WAIT ]]; then
    echo "ERROR: Backend not healthy after ${MAX_WAIT}s"
    echo "Check: docker compose logs backend"
    exit 1
  fi
done
echo "   Backend is UP at $BASE_URL"
echo ""

# 3. Run tests
echo "[3/4] Running E2E tests..."
echo ""

VENV_PYTHON="$ROOT/backend/venv/bin/python"
if [[ -f "$VENV_PYTHON" ]]; then
  PYTHON="$VENV_PYTHON"
else
  PYTHON="python3"
fi

echo "   Python: $PYTHON"
echo ""

"$PYTHON" "$ROOT/test/test_e2e_docker.py" \
  --base "$BASE_URL" \
  --timeout-llm "$LLM_TIMEOUT"
TEST_EXIT=$?

# 4. Optional stop
if [[ $STOP_AFTER -eq 1 ]]; then
  echo ""
  echo "[4/4] Stopping backend container..."
  docker compose stop backend
else
  echo ""
  echo "[4/4] Backend left running (use --stop-after to stop automatically)."
fi

echo ""
if [[ $TEST_EXIT -eq 0 ]]; then
  echo "All E2E tests PASSED."
else
  echo "Some E2E tests FAILED (exit=$TEST_EXIT)."
fi
echo ""
exit $TEST_EXIT
