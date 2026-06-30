#!/bin/bash
# Shell script to switch Gemini model version on Linux/Mac
# Usage: ./switch_model.sh

cd "$(dirname "$0")"
python3 switch_model.py
