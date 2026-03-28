"""Passive DNS, email-auth, and HTTPS checks for a public domain (no port scanning)."""

from __future__ import annotations

import os
import re
import socket
import ssl
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

import dns.exception
import dns.resolver

USER_AGENT = "ClearRisk-DomainScan/1.0"


def _dns_resolver() -> dns.resolver.Resolver:
    """Resolver for all scans. Set DOMAIN_SCAN_DNS_SERVERS=8.8.8.8,1.1.1.1 if system DNS is unreliable (e.g. some hosts)."""
    r = dns.resolver.Resolver()
    raw = (os.environ.get("DOMAIN_SCAN_DNS_SERVERS") or "").strip()
    if raw:
        r.nameservers = [p.strip() for p in raw.split(",") if p.strip()]
    return r


def normalize_domain(raw: str) -> str:
    s = raw.strip().lower()
    if not s:
        raise ValueError("Domain is required")
    s = re.sub(r"^https?://", "", s, flags=re.I)
    s = s.split("/")[0].strip()
    if ":" in s and not s.startswith("["):
        host_part = s.rsplit(":", 1)[0]
        s = host_part
    s = s.strip(".")
    if s.startswith("www."):
        s = s[4:]
    if not s or ".." in s or "/" in s or " " in s:
        raise ValueError("Invalid hostname")
    if len(s) > 253:
        raise ValueError("Hostname too long")
    return s


def _txt_records(host: str) -> list[str]:
    """Return all TXT strings for this name, following a short CNAME chain if there is no TXT at the first name."""
    res = _dns_resolver()
    name = host.rstrip(".").lower()
    visited: set[str] = set()
    for _ in range(8):
        if name in visited:
            break
        visited.add(name)
        try:
            ans = res.resolve(name, "TXT", lifetime=12)
        except dns.resolver.NXDOMAIN:
            return []
        except dns.resolver.NoAnswer:
            ans = None
        except (dns.exception.DNSException, OSError):
            return []
        blobs: list[str] = []
        if ans:
            for r in ans:
                blob = b"".join(r.strings).decode("utf-8", errors="replace")
                blobs.append(blob)
        if blobs:
            return blobs
        try:
            cans = res.resolve(name, "CNAME", lifetime=12)
            name = str(cans[0].target).rstrip(".").lower()
        except (dns.exception.DNSException, OSError):
            break
    return []


def _dmarc_txt_has_v1(txt: str) -> bool:
    """True if this TXT is a DMARC record (case-insensitive; spaces ignored for the tag check)."""
    compact = txt.upper().replace(" ", "")
    return "V=DMARC1" in compact


def scan_domain(hostname: str) -> dict[str, Any]:
    host = normalize_domain(hostname)
    checks: list[dict[str, Any]] = []
    issues: list[str] = []

    # --- DNS A ---
    a_records: list[str] = []
    try:
        ans = _dns_resolver().resolve(host, "A", lifetime=12)
        a_records = [str(r) for r in ans]
        checks.append(
            {
                "id": "dns_a",
                "group": "dns",
                "label": "IPv4 (A records)",
                "ok": True,
                "detail": f"{len(a_records)} IPv4 address(es)",
            }
        )
    except dns.exception.DNSException as e:
        checks.append(
            {
                "id": "dns_a",
                "group": "dns",
                "label": "IPv4 (A records)",
                "ok": False,
                "detail": str(e),
            }
        )
        issues.append("No IPv4 (A) DNS records found for this hostname.")

    # --- MX ---
    mx_records: list[tuple[int, str]] = []
    try:
        ans = _dns_resolver().resolve(host, "MX", lifetime=12)
        mx_records = sorted((r.preference, str(r.exchange).rstrip(".")) for r in ans)
        ok_mx = len(mx_records) > 0
        checks.append(
            {
                "id": "mx",
                "group": "dns",
                "label": "Mail servers (MX)",
                "ok": ok_mx,
                "detail": ", ".join(f"{p} {n}" for p, n in mx_records[:5]) if mx_records else "None",
            }
        )
        if not ok_mx:
            issues.append("No MX records — inbound email may not be configured.")
    except dns.exception.DNSException as e:
        checks.append(
            {
                "id": "mx",
                "group": "dns",
                "label": "Mail servers (MX)",
                "ok": False,
                "detail": str(e),
            }
        )
        issues.append("Could not read MX records.")

    # --- SPF ---
    spf: str | None = None
    for txt in _txt_records(host):
        if txt.strip().lower().startswith("v=spf1"):
            spf = txt
            break
    checks.append(
        {
            "id": "spf",
            "group": "email_auth",
            "label": "SPF",
            "ok": spf is not None,
            "detail": (spf[:120] + "…") if spf and len(spf) > 120 else (spf or "No v=spf1 TXT at apex"),
        }
    )
    if not spf:
        issues.append("No SPF record (TXT starting with v=spf1).")

    # --- DMARC ---
    dmarc_record: str | None = None
    dmarc_policy: str | None = None
    dmarc_host = f"_dmarc.{host}"
    for txt in _txt_records(dmarc_host):
        if _dmarc_txt_has_v1(txt):
            dmarc_record = txt
            m = re.search(r"\bp=(none|quarantine|reject)\b", txt, re.I)
            if m:
                dmarc_policy = m.group(1).lower()
            break
    dmarc_ok = dmarc_record is not None and dmarc_policy != "none"
    checks.append(
        {
            "id": "dmarc",
            "group": "email_auth",
            "label": "DMARC",
            "ok": dmarc_ok,
            "detail": f"p={dmarc_policy}" if dmarc_policy else (dmarc_record[:100] if dmarc_record else f"No DMARC at {dmarc_host}"),
        }
    )
    if not dmarc_record:
        issues.append("No DMARC policy (_dmarc TXT with v=DMARC1).")
    elif dmarc_policy == "none":
        issues.append("DMARC is present but policy is p=none (monitoring only).")

    # --- HTTPS reachability + HSTS ---
    https_ok = False
    hsts = False
    final_https_url: str | None = None
    try:
        req = urllib.request.Request(
            f"https://{host}/",
            headers={"User-Agent": USER_AGENT},
            method="GET",
        )
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            final_https_url = resp.geturl()
            https_ok = True
            hsts = resp.headers.get("Strict-Transport-Security") is not None
    except urllib.error.HTTPError as e:
        if e.code < 500:
            https_ok = True
            final_https_url = e.geturl() or f"https://{host}/"
            hsts = e.headers.get("Strict-Transport-Security") is not None
        else:
            checks.append(
                {
                    "id": "https",
                    "group": "certificate",
                    "label": "HTTPS",
                    "ok": False,
                    "detail": f"HTTP {e.code}: {e.reason}",
                }
            )
            issues.append("HTTPS returned a server error (5xx).")
    except (urllib.error.URLError, OSError, ssl.SSLError, TimeoutError) as e:
        checks.append(
            {
                "id": "https",
                "group": "certificate",
                "label": "HTTPS",
                "ok": False,
                "detail": str(e),
            }
        )
        issues.append("HTTPS site did not load successfully (certificate, TLS, or network).")

    if https_ok:
        checks.append(
            {
                "id": "https",
                "group": "certificate",
                "label": "HTTPS",
                "ok": True,
                "detail": final_https_url or f"https://{host}/",
            }
        )
        checks.append(
            {
                "id": "hsts",
                "group": "header",
                "label": "HSTS",
                "ok": hsts,
                "detail": "Strict-Transport-Security present" if hsts else "No HSTS header on response",
            }
        )
        if not hsts:
            issues.append("No HTTP Strict Transport Security (HSTS) header.")

    # --- Certificate expiry (TLS) ---
    cert_days_left: int | None = None
    cert_detail = "N/A"
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((host, 443), timeout=10) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as ssock:
                cert = ssock.getpeercert()
                na = cert.get("notAfter")
                if na:
                    exp_ts = ssl.cert_time_to_seconds(na)
                    exp = datetime.fromtimestamp(exp_ts, tz=timezone.utc)
                    cert_days_left = max(0, int((exp - datetime.now(timezone.utc)).total_seconds() // 86400))
                    cert_detail = f"Expires in ~{cert_days_left} days"
                    if cert_days_left < 14:
                        issues.append("TLS certificate expires in under 14 days.")
    except OSError:
        cert_detail = "Could not inspect certificate"

    checks.append(
        {
            "id": "tls_cert",
            "group": "certificate",
            "label": "TLS certificate",
            "ok": cert_days_left is None or cert_days_left >= 14,
            "detail": cert_detail,
        }
    )

    # --- Optional: HTTP → HTTPS ---
    http_redirects_https = False
    try:
        req = urllib.request.Request(
            f"http://{host}/",
            headers={"User-Agent": USER_AGENT},
            method="HEAD",
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            final = (resp.geturl() or "").lower()
            http_redirects_https = final.startswith("https://")
    except (urllib.error.HTTPError, urllib.error.URLError, OSError, TimeoutError):
        pass
    checks.append(
        {
            "id": "http_to_https",
            "group": "header",
            "label": "HTTP → HTTPS redirect",
            "ok": http_redirects_https or https_ok,
            "detail": "HTTP redirects to HTTPS" if http_redirects_https else "No HTTP→HTTPS redirect detected (or HTTP unavailable)",
        }
    )

    # Simple score: weighted deductions
    score = 100
    if not a_records:
        score -= 28
    if not mx_records:
        score -= 8
    if not spf:
        score -= 12
    if not dmarc_record:
        score -= 14
    elif dmarc_policy == "none":
        score -= 4
    if not https_ok:
        score -= 22
    elif not hsts:
        score -= 5
    if cert_days_left is not None and cert_days_left < 14:
        score -= 10
    if not http_redirects_https and https_ok:
        score -= 3
    score = max(0, min(100, score))

    return {
        "domain": host,
        "score": score,
        "check_groups_meta": [
            {"id": "dns", "title": "DNS"},
            {"id": "email_auth", "title": "Email authentication"},
            {"id": "certificate", "title": "Certificate"},
            {"id": "header", "title": "Headers"},
        ],
        "a_records": a_records,
        "mx_records": [{"priority": p, "host": n} for p, n in mx_records],
        "spf": spf,
        "dmarc": dmarc_record,
        "dmarc_policy": dmarc_policy,
        "https_ok": https_ok,
        "https_final_url": final_https_url,
        "hsts": hsts,
        "http_redirects_https": http_redirects_https,
        "cert_days_remaining": cert_days_left,
        "checks": checks,
        "issues": issues,
    }
