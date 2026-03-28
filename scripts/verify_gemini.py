"""Verify GEMINI_API_KEY and model respond (run from repo root: python scripts/verify_gemini.py)."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Load .env from project root before checking os.environ
_root = Path(__file__).resolve().parents[1]
try:
    from dotenv import load_dotenv

    load_dotenv(_root / ".env")
except ImportError:
    pass


def main() -> int:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        print("FAIL: GEMINI_API_KEY is not set (add to .env or environment).")
        return 1

    model_name = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip()
    print(f"Model: {model_name!r}, key length: {len(key)}")

    import google.generativeai as genai

    genai.configure(api_key=key)
    model = genai.GenerativeModel(model_name)
    prompt = 'Reply with exactly this JSON array and no other text: ["ok"]'

    try:
        r = model.generate_content(
            prompt,
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
            ),
        )
    except Exception as e1:  # noqa: BLE001
        print(f"Note: JSON mode failed ({e1!s}); retrying without response_mime_type…")
        try:
            r = model.generate_content(prompt)
        except Exception as e2:  # noqa: BLE001
            print(f"FAIL: generate_content error: {e2!s}")
            return 1

    text = getattr(r, "text", None) or ""
    print("Response text:", repr(text[:500]))
    try:
        data = json.loads(text.strip())
    except json.JSONDecodeError as e:
        print(f"FAIL: not valid JSON: {e!s}")
        return 1
    if data != ["ok"]:
        print(f"FAIL: unexpected JSON: {data!r}")
        return 1
    print("OK: Gemini responded with valid JSON.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
