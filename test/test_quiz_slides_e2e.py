"""
E2E Integration Tests — Quiz & Slide Endpoints
==============================================
Part 4 of the implementation plan: Testing & Validation.

Tests:
  T1. Health check
  T2. Auth: register + login
  T3. Quiz: generate → save attempt → get stats → history
  T4. Slide: generate outline → health → save draft → load draft
  T5. Type alignment: response fields match frontend interfaces

Run:
    python test/test_quiz_slides_e2e.py
"""

import json
import os
import time
import sys
import requests
from pathlib import Path

# Fix Windows terminal encoding
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Load .env so tests can reach real API keys
def load_dotenv(dotenv_path: Path):
    if not dotenv_path.exists():
        return
    for line in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:  # don't override already-set vars
            os.environ[key] = val

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")

BASE = "http://localhost:8000/api"
TIMEOUT = 90  # LLM calls can take a while

# ── Color helpers ─────────────────────────────────────────────────────────────
OK  = "[OK]"
ERR = "[FAIL]"
INF = "-->"

passed = 0
failed = 0

def check(label: str, condition: bool, detail: str = ""):
    global passed, failed
    if condition:
        print(f"  {OK} {label}")
        passed += 1
    else:
        print(f"  {ERR} {label}{f'  [{detail}]' if detail else ''}")
        failed += 1

def section(title: str):
    print(f"\n{'='*55}")
    print(f"  {INF} {title}")
    print(f"{'='*55}")

# ── Shared state ──────────────────────────────────────────────────────────────
token: str = ""
project_id: str = ""
quiz_attempt_id: int = 0

LESSON_CONTENT = """
# Cấu trúc Dữ liệu - Stack và Queue

## 1. Stack (Ngăn xếp)
Stack là cấu trúc dữ liệu theo nguyên tắc LIFO (Last In First Out).
Các thao tác chính: push, pop, peek, isEmpty.
Ứng dụng: quản lý bộ nhớ, undo/redo, DFS.

## 2. Queue (Hàng đợi)
Queue hoạt động theo nguyên tắc FIFO (First In First Out).
Các thao tác chính: enqueue, dequeue, front, isEmpty.
Ứng dụng: BFS, print spooler, task scheduling.

## 3. So sánh
| Tiêu chí | Stack | Queue |
|----------|-------|-------|
| Thứ tự | LIFO | FIFO |
| Thêm | push (top) | enqueue (rear) |
| Xóa | pop (top) | dequeue (front) |
| Ứng dụng | Đệ quy, DFS | BFS, lập lịch |
"""

# ══════════════════════════════════════════════════════════════════════════════
# T1. Health check
# ══════════════════════════════════════════════════════════════════════════════
section("T1 — Health Check")
try:
    r = requests.get("http://localhost:8000/health", timeout=10)
    check("Backend reachable (200)", r.status_code == 200)
    check("Response is JSON", r.headers.get("content-type","").startswith("application/json"))
except Exception as e:
    check("Backend reachable", False, str(e))
    print("\n[FATAL] Cannot reach backend. Stopping tests.")
    sys.exit(1)

# ══════════════════════════════════════════════════════════════════════════════
# T2. Auth: register + login
# ══════════════════════════════════════════════════════════════════════════════
section("T2 — Authentication")
TEST_EMAIL = f"e2e_test_{int(time.time())}@test.com"
TEST_PASS  = "TestPass@123"

try:
    r = requests.post(f"{BASE}/auth/register", json={
        "email": TEST_EMAIL, "password": TEST_PASS, "confirm_password": TEST_PASS
    }, timeout=10)
    check("Register returns 2xx", r.status_code in (200, 201), f"status={r.status_code}")
except Exception as e:
    check("Register request", False, str(e))

try:
    r = requests.post(f"{BASE}/auth/login", json={
        "email": TEST_EMAIL, "password": TEST_PASS
    }, timeout=10)
    check("Login returns 200", r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        data = r.json()
        token = data.get("data", {}).get("access_token", "")
        check("Access token received",   bool(token), "token empty")
        check("Token type is Bearer",    data.get("data", {}).get("token_type") == "bearer")
        check("User role field present", "role" in data.get("data", {}).get("user", {}))
except Exception as e:
    check("Login request", False, str(e))

AUTH = {"Authorization": f"Bearer {token}"} if token else {}

# ══════════════════════════════════════════════════════════════════════════════
# T3. Quiz flow
# ══════════════════════════════════════════════════════════════════════════════
section("T3 — Quiz: Generate → Save → Stats → History")

# 3a. Generate quiz
print(f"\n  [3a] Generate quiz (5 questions)...")
try:
    t0 = time.time()
    r = requests.post(f"{BASE}/quiz/generate-quiz", json={
        "lesson_content": LESSON_CONTENT,
        "num_questions": 5,
    }, headers=AUTH, timeout=TIMEOUT)
    elapsed = round(time.time() - t0, 1)
    check(f"Generate returns 200 ({elapsed}s)", r.status_code == 200, f"status={r.status_code}, body={r.text[:200]}")
    
    if r.status_code == 200:
        data = r.json()
        questions = data.get("questions", [])
        seed      = data.get("variation_seed")
        
        check("Response has 'questions' list",       isinstance(questions, list))
        check("Response has 'variation_seed' int",   isinstance(seed, int))
        check("Got ≥1 question",                     len(questions) >= 1, f"got {len(questions)}")
        check("≤5 questions (requested 5)",          len(questions) <= 5, f"got {len(questions)}")
        
        if questions:
            q = questions[0]
            check("Question has 'id' field",          "id" in q)
            check("Question has 'question' string",   isinstance(q.get("question"), str) and len(q["question"]) > 5)
            check("Question has 4 options",           isinstance(q.get("options"), list) and len(q["options"]) == 4)
            check("correct_answer is A/B/C/D",        q.get("correct_answer") in ("A","B","C","D"))
            check("Question has 'explanation'",       isinstance(q.get("explanation"), str) and len(q.get("explanation","")) > 3)
            check("Question has valid 'type'",        q.get("type") in ("concept","application","outcome","error"))
        
        # Build mock answers for save test
        answers = {q["id"]: q["correct_answer"] for q in questions[:3]}
        answers.update({q["id"]: "A" for q in questions[3:]})  # wrong answers for rest
        correct_count = sum(1 for q in questions if answers.get(q["id"]) == q["correct_answer"])
        
        # 3b. Save attempt
        print(f"\n  [3b] Save quiz attempt...")
        r2 = requests.post(f"{BASE}/quiz/save-attempt", json={
            "score":          correct_count,
            "total":          len(questions),
            "num_questions":  len(questions),
            "answers":        answers,
            "variation_seed": seed,
        }, headers=AUTH, timeout=15)
        check("Save attempt returns 200", r2.status_code == 200, f"status={r2.status_code}")
        if r2.status_code == 200:
            saved = r2.json()
            quiz_attempt_id = saved.get("id", 0)
            check("Save response has 'id'",          isinstance(saved.get("id"), int))
            check("Save response has 'score'",       saved.get("score") == correct_count)
            check("Save response has 'percentage'",  isinstance(saved.get("percentage"), float))
            check("Save response has 'created_at'",  isinstance(saved.get("created_at"), str))
        
        # 3c. Stats
        print(f"\n  [3c] Quiz stats...")
        r3 = requests.get(f"{BASE}/quiz/stats", headers=AUTH, timeout=10)
        check("Stats returns 200", r3.status_code == 200, f"status={r3.status_code}")
        if r3.status_code == 200:
            stats = r3.json()
            check("Stats has 'attempts' ≥1",         isinstance(stats.get("attempts"), int) and stats["attempts"] >= 1)
            check("Stats has 'avg_percentage'",       "avg_percentage" in stats)
            check("Stats has 'best_percentage'",      "best_percentage" in stats)
            check("Stats has 'last_attempt_at'",      "last_attempt_at" in stats)
        
        # 3d. History
        print(f"\n  [3d] Quiz history...")
        r4 = requests.get(f"{BASE}/quiz/history?limit=5", headers=AUTH, timeout=10)
        check("History returns 200",             r4.status_code == 200, f"status={r4.status_code}")
        if r4.status_code == 200:
            hist = r4.json()
            check("History has 'attempts' list", isinstance(hist.get("attempts"), list))
            check("History has ≥1 attempt",      len(hist.get("attempts", [])) >= 1)

except Exception as e:
    check("Quiz flow", False, str(e))

# ══════════════════════════════════════════════════════════════════════════════
# T4. Slide flow
# ══════════════════════════════════════════════════════════════════════════════
section("T4 — Slide: Health → Generate → Save Draft → Load Draft")

# 4a. Slides health check
print(f"\n  [4a] Slides health check...")
try:
    r = requests.get(f"{BASE}/slides/health", timeout=10)
    check("Health endpoint returns 200",     r.status_code == 200)
    if r.status_code == 200:
        h = r.json()
        check("Health has 'pptx_available'", "pptx_available" in h)
        pptx_ok = h.get("pptx_available", False)
        print(f"       pptx_available = {pptx_ok}  (pptx_error: {h.get('pptx_error')})")
except Exception as e:
    check("Slides health", False, str(e))

# 4b. Generate slide outline
print(f"\n  [4b] Generate slide outline (5 slides)...")
slides_data = []
try:
    t0 = time.time()
    r = requests.post(f"{BASE}/slides/generate-outline", json={
        "lesson_content": LESSON_CONTENT,
        "num_slides": 5,
    }, headers=AUTH, timeout=TIMEOUT)
    elapsed = round(time.time() - t0, 1)
    check(f"Generate outline returns 200 ({elapsed}s)", r.status_code == 200, f"status={r.status_code}, body={r.text[:200]}")
    
    if r.status_code == 200:
        data = r.json()
        slides_data = data.get("slides", [])
        total       = data.get("total", 0)
        
        check("Response has 'slides' list",    isinstance(slides_data, list))
        check("Response has 'total' int",      isinstance(total, int))
        check("Got ≥3 slides",                 len(slides_data) >= 3, f"got {len(slides_data)}")
        check("'total' matches slides length", total == len(slides_data))
        
        if slides_data:
            s = slides_data[0]
            check("Slide has 'title' string",          isinstance(s.get("title"), str) and len(s["title"]) > 2)
            check("Slide has 'bullet_points' list",    isinstance(s.get("bullet_points"), list) and len(s["bullet_points"]) >= 1)
            check("Slide has 'speaker_notes' string",  isinstance(s.get("speaker_notes"), str))
            check("Bullet points ≤8 (validator)",      len(s["bullet_points"]) <= 8)

except Exception as e:
    check("Slide outline", False, str(e))

# 4c. Save slide draft (needs project_id — use a dummy one)
print(f"\n  [4c] Save slide draft...")
DUMMY_PROJECT = f"test_project_{int(time.time())}"
if slides_data:
    try:
        r = requests.post(f"{BASE}/slides/save-draft", json={
            "project_id": DUMMY_PROJECT,
            "title":      "Test Bài giảng E2E",
            "slides":     slides_data[:3],
            "layouts":    {"0": "standard", "1": "two_column", "2": "big_title"},
        }, headers=AUTH, timeout=15)
        check("Save draft returns 200", r.status_code == 200, f"status={r.status_code}")
        if r.status_code == 200:
            saved = r.json()
            check("Draft has 'id'",          isinstance(saved.get("id"), int))
            check("Draft has 'slide_count'", saved.get("slide_count") == 3)
            check("Draft has 'saved_at'",    isinstance(saved.get("saved_at"), str))
    except Exception as e:
        check("Save slide draft", False, str(e))
    
    # 4d. Load slide draft
    print(f"\n  [4d] Load slide draft...")
    try:
        r = requests.get(f"{BASE}/slides/load-draft/{DUMMY_PROJECT}", headers=AUTH, timeout=10)
        check("Load draft returns 200",      r.status_code == 200, f"status={r.status_code}")
        if r.status_code == 200:
            draft = r.json()
            check("Draft 'found' is True",   draft.get("found") is True)
            check("Draft has 'slides' list", isinstance(draft.get("slides"), list) and len(draft["slides"]) == 3)
            check("Draft has 'layouts' dict",isinstance(draft.get("layouts"), dict))
            check("Draft has 'title'",       isinstance(draft.get("title"), str))
    except Exception as e:
        check("Load slide draft", False, str(e))
else:
    check("Save/Load draft skipped (no slides from gen)", False, "No slides generated")

# ══════════════════════════════════════════════════════════════════════════════
# T5. PPTX / PDF download (only if pptx available)
# ══════════════════════════════════════════════════════════════════════════════
section("T5 — Download: PPTX & PDF")
if slides_data:
    # PDF (reportlab — usually always available)
    print(f"\n  [5a] Download PDF...")
    try:
        r = requests.post(f"{BASE}/slides/download-pdf", json={
            "slides": slides_data[:3],
            "title":  "Test E2E"
        }, headers=AUTH, timeout=30)
        check("PDF returns 200",                r.status_code == 200, f"status={r.status_code}")
        check("Content-Type is application/pdf",r.headers.get("content-type","").startswith("application/pdf"),
              r.headers.get("content-type",""))
        check("PDF size > 500 bytes",           len(r.content) > 500, f"size={len(r.content)}")
    except Exception as e:
        check("PDF download", False, str(e))

    # PPTX
    print(f"\n  [5b] Download PPTX...")
    try:
        r = requests.post(f"{BASE}/slides/download-pptx", json={
            "slides": slides_data[:3],
            "title":  "Test E2E"
        }, headers=AUTH, timeout=30)
        if r.status_code == 503:
            print(f"       ⚠ PPTX unavailable (python-pptx not installed) — SKIP")
        else:
            check("PPTX returns 200", r.status_code == 200, f"status={r.status_code}")
            check("PPTX size > 1KB",  len(r.content) > 1024, f"size={len(r.content)}")
    except Exception as e:
        check("PPTX download", False, str(e))
else:
    print("  ⚠ Skipped (no slides)")

# ══════════════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════════════
total_tests = passed + failed
print(f"\n{'═'*55}")
print(f"  SUMMARY: {passed}/{total_tests} passed, {failed} failed")
print(f"{'═'*55}\n")
sys.exit(0 if failed == 0 else 1)
