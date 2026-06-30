#!/usr/bin/env python3
"""
Automatic model checker for Gemini/Gemma in Google AI Studio.

What it does:
- Loads model settings from .env
- Lists models that support generateContent
- Verifies configured primary/fallback/candidate models
- Optionally runs small generate tests
"""

import os
import sys
import re
from pathlib import Path


def load_env_from_file(env_path: Path) -> None:
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        os.environ[key.strip()] = value.strip()


def normalize_model_name(name: str) -> str:
    value = (name or "").strip()
    if value.startswith("models/"):
        value = value.split("/", 1)[1]
    return value


def parse_model_list(value: str) -> list[str]:
    if not value or not value.strip():
        return []
    return [normalize_model_name(x) for x in re.split(r"[,;\n]", value) if x.strip()]


def dedupe(items: list[str]) -> list[str]:
    seen = set()
    ordered: list[str] = []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            ordered.append(item)
    return ordered


def check_available_models() -> int:
    try:
        import google.generativeai as genai

        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            print("[ERROR] GEMINI_API_KEY is missing in .env")
            return 2

        genai.configure(api_key=api_key)

        primary = normalize_model_name(os.getenv("GEMINI_LLM_MODEL", ""))
        fallbacks = parse_model_list(os.getenv("GEMINI_LLM_MODEL_FALLBACKS", ""))
        candidates = parse_model_list(os.getenv("GEMINI_LLM_MODEL_CANDIDATES", ""))
        configured_order = dedupe([primary, *fallbacks, *candidates])

        auto_probe = os.getenv("GEMINI_MODEL_AUTO_PROBE", "true").lower() in {"1", "true", "yes", "on"}
        probe_generation = os.getenv("GEMINI_MODEL_PROBE_GENERATION", "false").lower() in {"1", "true", "yes", "on"}
        probe_prompt = os.getenv("GEMINI_MODEL_PROBE_PROMPT", "Tra loi mot tu: OK")

        print("=" * 70)
        print("MODEL SELF CHECK")
        print("=" * 70)

        print(f"Primary: {primary or '(empty)'}")
        print(f"Fallbacks: {', '.join(fallbacks) if fallbacks else '(none)'}")
        print(f"Candidates: {', '.join(candidates) if candidates else '(none)'}")
        print(f"Auto probe: {auto_probe}")
        print(f"Generation probe: {probe_generation}")
        print("-" * 70)

        available_set = set()
        available_ordered: list[str] = []
        for m in genai.list_models():
            methods = getattr(m, "supported_generation_methods", []) or []
            if "generateContent" not in methods:
                continue
            name = normalize_model_name(getattr(m, "name", ""))
            if not name or name in available_set:
                continue
            available_set.add(name)
            available_ordered.append(name)

        if not available_ordered:
            print("[WARN] No generateContent models returned from API.")
            return 1

        print(f"Available generate models ({len(available_ordered)}):")
        for name in available_ordered:
            print(f"  - {name}")

        print("-" * 70)
        missing = [m for m in configured_order if m not in available_set]
        valid = [m for m in configured_order if m in available_set]
        print(f"Configured and available: {', '.join(valid) if valid else '(none)'}")
        print(f"Configured but unavailable: {', '.join(missing) if missing else '(none)'}")

        if valid:
            print(f"Recommended primary now: {valid[0]}")
        else:
            print(f"Recommended primary now: {available_ordered[0]}")

        if probe_generation:
            print("-" * 70)
            print("Generation probe result:")
            test_list = valid[:3] if valid else available_ordered[:3]
            for name in test_list:
                try:
                    model = genai.GenerativeModel(name)
                    response = model.generate_content(probe_prompt)
                    text = (getattr(response, "text", "") or "").strip()
                    if text:
                        print(f"  [OK] {name} -> {text[:80]}")
                    else:
                        print(f"  [WARN] {name} -> empty response")
                except Exception as exc:
                    print(f"  [FAIL] {name} -> {exc}")

        return 0

    except ImportError:
        print("[ERROR] google-generativeai is not installed")
        print("Install: pip install google-generativeai")
        return 2
    except Exception as e:
        print(f"[ERROR] Model check failed: {e}")
        print("Possible causes: invalid API key, exhausted quota, network issue")
        return 1

if __name__ == "__main__":
    env_file = Path(__file__).parent / ".env"
    load_env_from_file(env_file)
    raise SystemExit(check_available_models())
