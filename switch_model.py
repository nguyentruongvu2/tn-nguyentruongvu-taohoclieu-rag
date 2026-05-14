#!/usr/bin/env python3
"""
Switch Gemini LLM Model Version
Script to easily switch between different Gemini model versions
"""

import os
import re
from pathlib import Path

# Available models
AVAILABLE_MODELS = {
    "1": ("gemini-1.5-flash", "Gemini 1.5 Flash"),
    "2": ("gemini-1.5-pro", "Gemini 1.5 Pro"),
    "3": ("gemini-2.5-flash-lite", "Gemini 2.5 Flash Lite"),
    "4": ("gemini-3-flash", "Gemini 3 Flash"),
    "5": ("gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite"),
    "6": ("gemini-3.1-pro", "Gemini 3.1 Pro"),
    "7": ("gemma-3-2b-it", "Gemma 3 2B"),
}


def parse_model_list(value):
    if not value or not value.strip():
        return []
    return [x.strip() for x in re.split(r"[,;\n]", value) if x.strip()]


def dedupe(items):
    seen = set()
    ordered = []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            ordered.append(item)
    return ordered


def read_env_key(content, key):
    pattern = re.compile(rf"^{re.escape(key)}=(.*)$", re.MULTILINE)
    match = pattern.search(content)
    if not match:
        return ""
    return match.group(1).strip()

def get_env_path():
    """Find .env file"""
    current_dir = Path(__file__).parent
    env_file = current_dir / ".env"
    if not env_file.exists():
        raise FileNotFoundError(f".env not found in {current_dir}")
    return env_file

def read_env(env_path):
    """Read .env file"""
    with open(env_path, 'r', encoding='utf-8') as f:
        return f.read()

def write_env(env_path, content):
    """Write .env file"""
    with open(env_path, 'w', encoding='utf-8') as f:
        f.write(content)

def upsert_env_key(content, key, value):
    lines = content.split('\n')
    prefix = f"{key}="
    for idx, line in enumerate(lines):
        if line.startswith(prefix):
            lines[idx] = f"{key}={value}"
            return "\n".join(lines)
    lines.append(f"{key}={value}")
    return "\n".join(lines)


def switch_model(env_path, new_model):
    """Switch primary model and refresh fallbacks."""
    content = read_env(env_path)
    existing_fallbacks = parse_model_list(read_env_key(content, "GEMINI_LLM_MODEL_FALLBACKS"))
    default_pool = [model for model, _ in AVAILABLE_MODELS.values()]
    merged = dedupe([new_model, *existing_fallbacks, *default_pool])
    fallbacks = [m for m in merged if m != new_model]

    content = upsert_env_key(content, "GEMINI_LLM_MODEL", new_model)
    content = upsert_env_key(content, "GEMINI_LLM_MODEL_FALLBACKS", ",".join(fallbacks[:8]))

    existing_candidates = parse_model_list(read_env_key(content, "GEMINI_LLM_MODEL_CANDIDATES"))
    candidate_pool = dedupe([new_model, *fallbacks, *existing_candidates])
    content = upsert_env_key(content, "GEMINI_LLM_MODEL_CANDIDATES", ",".join(candidate_pool[:12]))

    write_env(env_path, content)
    return content

def show_menu():
    """Display menu of available models"""
    print("\n" + "="*70)
    print("Gemini/Gemma Model Switcher")
    print("="*70)
    print("\nAvailable Models:\n")
    
    for key, (model, description) in AVAILABLE_MODELS.items():
        print(f"  {key}. {description}")
        print(f"     → {model}\n")
    
    print("="*70)

def get_current_model(env_path):
    """Get currently active model"""
    content = read_env(env_path)
    for line in content.split('\n'):
        if line.startswith('GEMINI_LLM_MODEL=') and not line.startswith('# GEMINI_LLM_MODEL='):
            return line.split('=', 1)[1].strip()
    return "Unknown"

def main():
    try:
        env_path = get_env_path()
        current_model = get_current_model(env_path)
        
        print(f"\n📍 Current Model: {current_model}")
        
        show_menu()
        
        choice = input("\nSelect model (1-7) or 'q' to quit: ").strip()
        
        if choice.lower() == 'q':
            print("Cancelled.")
            return
        
        if choice not in AVAILABLE_MODELS:
            print(f"❌ Invalid choice: {choice}")
            return
        
        new_model, description = AVAILABLE_MODELS[choice]
        
        if new_model == current_model:
            print(f"✓ Already using: {description}")
            return
        
        print(f"\n⏳ Switching to: {description}")
        switch_model(env_path, new_model)
        
        print(f"✅ Switched to: {new_model}")
        print(f"\nTo apply changes, restart backend:")
        print(f"   docker compose down")
        print(f"   docker compose up -d")
        
    except FileNotFoundError as e:
        print(f"❌ Error: {e}")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    main()
