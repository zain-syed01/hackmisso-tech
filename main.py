from __future__ import annotations

import json
import logging
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, RootModel, field_validator

from domain_security import scan_domain

logger = logging.getLogger(__name__)

_BASE = Path(__file__).resolve().parent
_ENV_PATH = _BASE / ".env"


def _refresh_env_from_dotenv() -> dict[str, Any]:
    """Load project .env into os.environ. Safe to call multiple times."""
    info: dict[str, Any] = {"path": str(_ENV_PATH), "exists": _ENV_PATH.is_file(), "dotenv_pkg": False}
    try:
        from dotenv import load_dotenv

        info["dotenv_pkg"] = True
        load_dotenv(_ENV_PATH, override=True)
    except ImportError:
        logger.warning("python-dotenv is not installed; .env will not load. Run: pip install python-dotenv")
    return info


_refresh_env_from_dotenv()


def _cors_allow_origins() -> list[str]:
    """Local dev origins plus optional comma-separated URLs from CORS_ALLOW_ORIGINS (e.g. your Vercel site)."""
    origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ]
    extra = (os.environ.get("CORS_ALLOW_ORIGINS") or "").strip()
    if not extra:
        return origins
    for part in extra.split(","):
        u = part.strip().rstrip("/")
        if u and u not in origins:
            origins.append(u)
    return origins


with (_BASE / "assessment_questions.json").open(encoding="utf-8") as _f:
    _BUNDLE: dict[str, Any] = json.load(_f)

SCORING_RANGES: list[dict[str, Any]] = _BUNDLE["meta"]["scoring_model"]["ranges"]


def _build_assessment_data(questions: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    data: dict[str, dict[str, Any]] = {}
    for q in questions:
        qid = q["id"]
        points = {str(opt["id"]): int(opt["score"]) for opt in q["options"]}
        option_meta = {
            str(opt["id"]): {
                "ai_rec": str(opt.get("ai_rec", "")),
                "label": str(opt.get("text", "")),
            }
            for opt in q["options"]
        }
        data[qid] = {
            "text": q["text"],
            "category": q.get("category", ""),
            "points": points,
            "options": option_meta,
        }
    return data


ASSESSMENT_DATA: dict[str, dict[str, Any]] = _build_assessment_data(_BUNDLE["questions"])
QUESTION_IDS: list[str] = [str(q["id"]) for q in _BUNDLE["questions"]]
MAX_RAW_RISK: int = sum(max(d["points"].values()) for d in ASSESSMENT_DATA.values())


def _risk_band(risk_total: float) -> tuple[str, str]:
    t = int(round(risk_total))
    for r in SCORING_RANGES:
        if int(r["min"]) <= t <= int(r["max"]):
            return str(r["level"]), str(r.get("message", ""))
    if t < int(SCORING_RANGES[0]["min"]):
        return str(SCORING_RANGES[0]["level"]), str(SCORING_RANGES[0].get("message", ""))
    return str(SCORING_RANGES[-1]["level"]), str(SCORING_RANGES[-1].get("message", ""))


def _extract_gemini_text(response: Any) -> str:
    try:
        t = getattr(response, "text", None)
        if t:
            return str(t).strip()
    except (ValueError, AttributeError, TypeError):
        pass
    try:
        parts: list[str] = []
        for cand in getattr(response, "candidates", None) or []:
            content = getattr(cand, "content", None)
            for part in getattr(content, "parts", None) or []:
                txt = getattr(part, "text", None)
                if txt:
                    parts.append(str(txt))
        return "\n".join(parts).strip()
    except (AttributeError, TypeError):
        return ""
    return ""


def _failed_checks(answers: dict[str, str]) -> list[dict[str, str]]:
    failed: list[dict[str, str]] = []
    for qid in QUESTION_IDS:
        opt_id = answers[qid]
        pts = ASSESSMENT_DATA[qid]["points"][opt_id]
        if pts > 0:
            om = ASSESSMENT_DATA[qid]["options"][opt_id]
            failed.append(
                {
                    "id": qid,
                    "text": ASSESSMENT_DATA[qid]["text"],
                    "risk_context": om["ai_rec"],
                    "risk_points": str(pts),
                }
            )
    failed.sort(key=lambda x: -int(x["risk_points"]))
    return failed


class RecommendationItem(BaseModel):
    text: str
    severity: str  # critical | high | medium | low


def _severity_sort_key(severity: str) -> int:
    return {"critical": 0, "high": 1, "medium": 2, "low": 3}.get(severity, 2)


def _risk_points_to_severity(pts: int) -> str:
    """Map JSON risk points to a severity band. This is the only source of truth for labels (not Gemini)."""
    if pts >= 20:
        return "critical"
    if pts >= 15:
        return "high"
    if pts >= 10:
        return "medium"
    return "low"


def _cap_severity_by_posture(severity: str, posture: float) -> str:
    """Soften per-gap severity when overall posture is strong — labels stay consistent with the headline %."""
    if posture >= 93.0:
        if severity == "critical":
            return "medium"
        if severity == "high":
            return "low"
        if severity == "medium":
            return "low"
    elif posture >= 88.0:
        if severity == "critical":
            return "high"
        if severity == "high":
            return "medium"
    return severity


def _fallback_item_for_failed_row(item: dict[str, str], idx: int) -> RecommendationItem:
    closers = [
        "Assign an owner and a target date to close this gap.",
        "Document the control you want, then verify it monthly.",
        "Review with your team quarterly and update your safety checklist.",
    ]
    closer = closers[min(idx, len(closers) - 1)]
    body = (
        f"Priority: {item['text']} (risk points: {item['risk_points']}). "
        f"{item['risk_context']} {closer}"
    )
    sev = _risk_points_to_severity(int(item["risk_points"]))
    return RecommendationItem(text=body, severity=sev)


def _parse_recommendation_json(
    raw: str, failed: list[dict[str, str]], posture: float | None = None
) -> list[RecommendationItem]:
    """Parse Gemini JSON. Severity always comes from each gap's risk_points (and optional posture cap), not the model."""
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
        text = re.sub(r"\s*```\s*$", "", text)
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end <= start:
        raise ValueError("No JSON array in model response")
    data = json.loads(text[start : end + 1])
    if not isinstance(data, list):
        raise ValueError("Response is not a JSON array")

    ranked = sorted(failed, key=lambda x: -int(x["risk_points"]))
    n = len(ranked)
    items: list[RecommendationItem] = []

    dict_mode = bool(data and isinstance(data[0], dict) and "text" in data[0])

    for i in range(n):
        row = ranked[i]
        pts = int(row["risk_points"])
        base_sev = _risk_points_to_severity(pts)
        sev = _cap_severity_by_posture(base_sev, posture) if posture is not None else base_sev

        t = ""
        if i < len(data):
            if dict_mode:
                obj = data[i]
                if isinstance(obj, dict):
                    t = str(obj.get("text", "")).strip()
            else:
                t = str(data[i]).strip()

        if not t:
            fb = _fallback_item_for_failed_row(row, i)
            # Keep Gemini-free fallback body but re-apply severity from points + posture
            fb_sev = _cap_severity_by_posture(_risk_points_to_severity(pts), posture) if posture is not None else _risk_points_to_severity(pts)
            items.append(RecommendationItem(text=fb.text, severity=fb_sev))
        else:
            items.append(RecommendationItem(text=t, severity=sev))

    return sorted(items, key=lambda x: _severity_sort_key(x.severity))


def _fallback_recommendation_items(failed: list[dict[str, str]], posture: float | None = None) -> list[RecommendationItem]:
    ranked = sorted(failed, key=lambda x: -int(x["risk_points"]))
    items: list[RecommendationItem] = []
    for idx, item in enumerate(ranked):
        fb = _fallback_item_for_failed_row(item, idx)
        pts = int(item["risk_points"])
        sev = _risk_points_to_severity(pts)
        if posture is not None:
            sev = _cap_severity_by_posture(sev, posture)
        items.append(RecommendationItem(text=fb.text, severity=sev))
    return sorted(items, key=lambda x: _severity_sort_key(x.severity))


def _gemini_recommendation_items(failed: list[dict[str, str]], posture: float | None) -> list[RecommendationItem]:
    import google.generativeai as genai  # noqa: PLC0415

    api_key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if not api_key:
        raise ValueError("GEMINI_API_KEY not set")

    genai.configure(api_key=api_key)
    model_name = (os.environ.get("GEMINI_MODEL") or "gemini-2.5-flash").strip()
    model = genai.GenerativeModel(model_name)

    failed_lines = []
    for item in failed:
        failed_lines.append(
            f"- {item['text']} (risk points {item['risk_points']}). Guidance: {item['risk_context']}"
        )
    failed_block = "\n".join(failed_lines)

    n = len(failed)
    prompt = f"""You are an expert cybersecurity coach writing for small businesses (8th-grade reading level). The user chose weaker answers on these topics:
{failed_block}

There are exactly {n} gaps listed above (in the order shown). Return a JSON array of exactly {n} objects, in the SAME order (first object = first gap).

Each object must be ONLY:
{{"text": "one clear actionable sentence"}}

Do not include severity or priority labels in the JSON — the app assigns those from risk_points. Match the tone to the gap: small risk_points mean a calm, maintenance-style suggestion; larger risk_points mean a more urgent tone in the sentence itself.

No markdown fences; output only valid JSON."""

    response = None
    try:
        response = model.generate_content(
            prompt,
            generation_config=genai.GenerationConfig(response_mime_type="application/json"),
        )
    except Exception as exc:  # noqa: BLE001
        logger.info("Gemini JSON mode unavailable or rejected (%s); retrying without response_mime_type.", exc)
        response = model.generate_content(prompt)

    raw = _extract_gemini_text(response)
    if not raw:
        raise ValueError("Gemini returned an empty or blocked response.")

    return _parse_recommendation_json(raw, failed, posture=posture)


def _recommendations_for_failed(
    failed: list[dict[str, str]], posture: float
) -> tuple[list[RecommendationItem], str, str | None]:
    """Returns (recommendations, source, provider_error). provider_error set when key exists but Gemini failed."""
    key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if key:
        try:
            items = _gemini_recommendation_items(failed, posture)
            items = sorted(items, key=lambda x: _severity_sort_key(x.severity))
            return items, "gemini", None
        except Exception as exc:  # noqa: BLE001
            logger.warning("Gemini recommendations failed; using built-in fallback: %s", exc)
            return _fallback_recommendation_items(failed, posture), "fallback", str(exc)
    return _fallback_recommendation_items(failed, posture), "fallback", None


class AnalyzeRequest(RootModel[dict[str, str]]):
    @field_validator("root")
    @classmethod
    def non_empty_values(cls, v: dict[str, str]) -> dict[str, str]:
        if not v:
            raise ValueError("answers object must not be empty")
        for qid, opt in v.items():
            if not isinstance(opt, str) or not opt.strip():
                raise ValueError(f"Empty option for question {qid!r}")
        return v


class AnalyzeResponse(BaseModel):
    overall_risk_score: float
    risk_total: float
    risk_band: str
    risk_band_message: str
    ai_recommendations: list[RecommendationItem]
    recommendation_source: str | None = None  # "gemini" | "fallback" | None when no gaps
    ai_provider_error: str | None = None  # set when key present but Gemini failed


class DomainScanRequest(BaseModel):
    domain: str


def _fallback_domain_surface_summary(scan: dict[str, Any]) -> str:
    """Plain-language score explanation when Gemini is unavailable."""
    score = int(scan.get("score", 0))
    dom = str(scan.get("domain", "this domain"))
    issues = scan.get("issues") or []
    n = len(issues) if isinstance(issues, list) else 0
    if score >= 85:
        if n:
            return (
                f"The surface score for {dom} is {score} out of 100 (higher is better)—strong overall. "
                f"There are still {n} finding(s) below worth a quick review."
            )
        return (
            f"The surface score for {dom} is {score} out of 100. From public DNS, HTTPS, and mail-related checks, "
            "things look in good shape for what we can see without logging into your systems."
        )
    if score >= 60:
        return (
            f"The surface score for {dom} is {score} out of 100—mixed. Some basics look fine, but the gaps below "
            "can affect how reliably email is trusted or how browsers reach your site securely."
        )
    return (
        f"The surface score for {dom} is {score} out of 100—several important items are missing or weak. "
        "Improving DNS, email authentication (SPF/DMARC), HTTPS or your certificate, and security headers "
        "would make the domain look much healthier from the outside."
    )


def _gemini_domain_surface_summary(scan: dict[str, Any]) -> str:
    import google.generativeai as genai  # noqa: PLC0415

    api_key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if not api_key:
        raise ValueError("GEMINI_API_KEY not set")

    genai.configure(api_key=api_key)
    model_name = (os.environ.get("GEMINI_MODEL") or "gemini-2.5-flash").strip()
    model = genai.GenerativeModel(model_name)

    lines: list[str] = []
    for c in scan.get("checks") or []:
        if not isinstance(c, dict):
            continue
        label = str(c.get("label") or c.get("id", "check"))
        st = "pass" if c.get("ok") else "fail"
        det = str(c.get("detail", ""))[:140]
        lines.append(f"- {label}: {st} — {det}")

    issues = scan.get("issues") or []
    issue_lines = [f"- {i}" for i in issues[:16]] if isinstance(issues, list) else []
    issues_block = "\n".join(issue_lines) if issue_lines else "(none listed)"

    prompt = f"""You explain external domain security scan results to a small-business owner.

Domain: {scan.get("domain")}
Surface score: {scan.get("score")} out of 100 (higher is better).

Check results:
{chr(10).join(lines)}

Notable issues:
{issues_block}

Write exactly 2 or 3 short sentences at about 8th-grade reading level. Plain text only—no markdown, no bullet characters, no title line. Explain what this score means in everyday language and mention DNS, email authentication (SPF/DMARC), HTTPS/certificate, or headers only if relevant to the results. Do not invent facts or numbers beyond what is given."""

    response = model.generate_content(prompt)
    raw = _extract_gemini_text(response)
    if not raw:
        raise ValueError("Gemini returned an empty response for domain summary.")
    return raw.strip()


def _enrich_domain_scan(scan: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = dict(scan)
    summary = _fallback_domain_surface_summary(scan)
    source = "fallback"
    key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if key:
        try:
            summary = _gemini_domain_surface_summary(scan)
            source = "gemini"
        except Exception as exc:  # noqa: BLE001
            logger.warning("Gemini domain surface summary failed; using fallback: %s", exc)
            summary = _fallback_domain_surface_summary(scan)
            source = "fallback"
    out["surface_summary"] = summary
    out["surface_summary_source"] = source
    return out


@asynccontextmanager
async def lifespan(app: FastAPI):
    info = _refresh_env_from_dotenv()
    key_len = len((os.environ.get("GEMINI_API_KEY") or "").strip())
    logger.info(
        "Startup: .env path=%s exists=%s python-dotenv=%s GEMINI_API_KEY length=%s",
        info["path"],
        info["exists"],
        info["dotenv_pkg"],
        key_len,
    )
    yield


app = FastAPI(title="ClearRisk Assessment API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_allow_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze(payload: AnalyzeRequest) -> AnalyzeResponse:
    try:
        answers = payload.root
        expected_ids = set(ASSESSMENT_DATA.keys())
        provided_ids = set(answers.keys())

        if provided_ids != expected_ids:
            missing = sorted(expected_ids - provided_ids)
            extra = sorted(provided_ids - expected_ids)
            detail: dict[str, Any] = {"message": "Provide exactly one answer per question."}
            if missing:
                detail["missing_question_ids"] = missing
            if extra:
                detail["unknown_question_ids"] = extra
            raise HTTPException(status_code=400, detail=detail)

        risk_total = 0.0
        for qid in QUESTION_IDS:
            opt_id = answers[qid]
            pts_map = ASSESSMENT_DATA[qid]["points"]
            if opt_id not in pts_map:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "message": f"Invalid option {opt_id!r} for question {qid!r}.",
                        "valid_options": sorted(pts_map.keys()),
                    },
                )
            risk_total += float(pts_map[opt_id])

        posture = round(100.0 * (1.0 - risk_total / MAX_RAW_RISK), 2) if MAX_RAW_RISK else 100.0
        band, band_msg = _risk_band(risk_total)

        failed = _failed_checks(answers)
        if not failed:
            return AnalyzeResponse(
                overall_risk_score=posture,
                risk_total=risk_total,
                risk_band=band,
                risk_band_message=band_msg,
                ai_recommendations=[],
                recommendation_source=None,
                ai_provider_error=None,
            )

        ai_items, source, provider_err = _recommendations_for_failed(failed, posture)
        ai_items = [r for r in ai_items if r.text.strip()]
        if not ai_items:
            ai_items = _fallback_recommendation_items(failed, posture)
            source = "fallback"
            if provider_err is None and (os.environ.get("GEMINI_API_KEY") or "").strip():
                provider_err = "Empty recommendation list after Gemini response."
        ai_items = sorted(ai_items, key=lambda x: _severity_sort_key(x.severity))

        return AnalyzeResponse(
            overall_risk_score=float(posture),
            risk_total=float(risk_total),
            risk_band=band,
            risk_band_message=band_msg,
            ai_recommendations=ai_items,
            recommendation_source=source,
            ai_provider_error=provider_err,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("POST /api/analyze failed")
        raise HTTPException(
            status_code=500,
            detail=f"Server error during analysis: {exc!s}. Check the uvicorn terminal for the full traceback.",
        ) from exc


@app.post("/api/domain-scan")
def domain_scan(body: DomainScanRequest) -> dict[str, Any]:
    try:
        return _enrich_domain_scan(scan_domain(body.domain))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as exc:  # noqa: BLE001
        logger.exception("POST /api/domain-scan failed")
        raise HTTPException(
            status_code=500,
            detail=f"Domain scan failed: {exc!s}",
        ) from exc


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/ai-status")
def ai_status() -> dict[str, Any]:
    """Whether Gemini is configured (never exposes the API key). Reloads .env each call."""
    info = _refresh_env_from_dotenv()
    key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    return {
        "gemini_api_key_configured": bool(key),
        "gemini_api_key_length": len(key),
        "gemini_model": (os.environ.get("GEMINI_MODEL") or "gemini-2.5-flash").strip(),
        "env_file_path": info["path"],
        "env_file_exists": info["exists"],
        "python_dotenv_installed": info["dotenv_pkg"],
    }
