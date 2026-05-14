#!/usr/bin/env bash
set -euo pipefail

echo "[predeploy] Build backend image with latest code..."
docker compose build --no-cache backend

echo "[predeploy] Run OCR math normalization regression test..."
docker compose run --rm --no-deps backend python -m app.test_math_formula_normalization

echo "[predeploy] Build frontend for type safety and bundle validation..."
(
  cd frontend
  npm run build
)

echo "[predeploy] PASSED: safe to deploy."
