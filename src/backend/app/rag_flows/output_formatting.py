from __future__ import annotations

import re


def format_output(markdown_text: str) -> str:
    text = (markdown_text or "").strip()
    if not text:
        return ""

    text = re.sub(r"\n{3,}", "\n\n", text)
    if not text.startswith("# "):
        text = "# Tai lieu giang day\n\n" + text
    return text.strip()
