$ErrorActionPreference = 'Stop'

Write-Host '[predeploy] Build backend image with latest code...'
docker compose build --no-cache backend

Write-Host '[predeploy] Run OCR math normalization regression test...'
docker compose run --rm --no-deps backend python -m app.test_math_formula_normalization

Write-Host '[predeploy] Build frontend for type safety and bundle validation...'
Push-Location frontend
npm run build
Pop-Location

Write-Host '[predeploy] PASSED: safe to deploy.'
