#!/usr/bin/env bash
# ============================================================
# smoke-test.sh — Post-deploy health check
# Usage: bash scripts/smoke-test.sh https://yourdomain.com
#        bash scripts/smoke-test.sh http://1.2.3.4
# ============================================================
set -euo pipefail

BASE_URL="${1:-http://localhost}"
BASE_URL="${BASE_URL%/}"   # strip trailing slash
PASS=0; FAIL=0

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'; BOLD='\033[1m'

ok()   { echo -e "${GREEN}✓${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}✗${NC} $1"; FAIL=$((FAIL+1)); }

check_http() {
    local desc="$1" url="$2" expected="${3:-200}"
    local status
    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$url" || echo "000")
    if [ "$status" = "$expected" ] || [ "$status" = "301" ] || [ "$status" = "302" ]; then
        ok "$desc (HTTP $status)"
    else
        fail "$desc — expected $expected, got $status"
    fi
}

check_json() {
    local desc="$1" url="$2" key="$3"
    local body
    body=$(curl -sf --max-time 15 "$url" 2>/dev/null || echo "{}")
    if echo "$body" | grep -q "$key"; then
        ok "$desc (found '$key')"
    else
        fail "$desc — key '$key' not found in: $body"
    fi
}

echo -e "\n${BOLD}═══════════════════════════════════════${NC}"
echo -e "${BOLD}  Smoke Test — $BASE_URL${NC}"
echo -e "${BOLD}═══════════════════════════════════════${NC}\n"

# ── Frontend ──────────────────────────────────────────────────────────────────
check_http "Frontend root"              "$BASE_URL/"            "200"

# ── Backend ───────────────────────────────────────────────────────────────────
check_http "Backend /api/docs"          "$BASE_URL/api/docs"    "200"
check_json "Slides health endpoint"     "$BASE_URL/api/slides/health" "pptx_available"
check_http "Quiz generate (no body)"    "$BASE_URL/api/quiz/generate-quiz" "422"  # 422 = missing body = route OK
check_http "Auth login (no body)"       "$BASE_URL/api/auth/login"  "422"

# ── SSL ────────────────────────────────────────────────────────────────────────
if [[ "$BASE_URL" == https://* ]]; then
    DOMAIN=$(echo "$BASE_URL" | sed 's|https://||' | cut -d/ -f1)
    CERT_EXPIRY=$(echo | openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" 2>/dev/null \
        | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || echo "N/A")
    if [ "$CERT_EXPIRY" != "N/A" ]; then
        ok "SSL certificate valid (expires: $CERT_EXPIRY)"
    else
        fail "SSL certificate check failed"
    fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}═══════════════════════════════════════${NC}"
echo -e "  Results: ${GREEN}$PASS passed${NC} | ${RED}$FAIL failed${NC}"
echo -e "${BOLD}═══════════════════════════════════════${NC}\n"

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
