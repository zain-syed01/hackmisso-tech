#!/usr/bin/env python3
"""Quick regression check for domain_security DMARC/SPF (run from repo root: python scripts/check_domain_scan.py)."""

from __future__ import annotations

import os
import sys

# Repo root on path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from domain_security import scan_domain  # noqa: E402


def main() -> None:
    domains = ["google.com", "cloudflare.com", "microsoft.com"]
    failed = False
    for d in domains:
        r = scan_domain(d)
        dmarc_ok = bool(r.get("dmarc"))
        spf_ok = bool(r.get("spf"))
        score = r.get("score", -1)
        bad_dmarc_issue = any("No DMARC policy" in i for i in (r.get("issues") or []))
        if not dmarc_ok or bad_dmarc_issue:
            print(f"FAIL {d}: expected DMARC detected; dmarc={r.get('dmarc')!r}, issues={r.get('issues')}")
            failed = True
        else:
            print(f"OK   {d}: score={score} DMARC policy={r.get('dmarc_policy')} SPF={'yes' if spf_ok else 'no'}")
    if failed:
        sys.exit(1)
    print("All checks passed.")


if __name__ == "__main__":
    main()
