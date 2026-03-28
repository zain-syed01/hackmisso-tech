from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, RootModel, field_validator

from domain_security import scan_domain

logger = logging.getLogger(__name__)

_BASE = Path(__file__).resolve().parent
try:
    from dotenv import load_dotenv

    load_dotenv(_BASE / ".env")
except ImportError:
    pass

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


def _parse_json_array_of_strings(raw: str) -> list[str]:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
        text = re.sub(r"\s*```\s*$", "", text)

    def _from_obj(data: Any) -> list[str]:
        if not isinstance(data, list):
            raise ValueError("Response is not a JSON array")
        out: list[str] = []
        for item in data:
            s = str(item).strip()
            if s:
                out.append(s)
        return out

    try:
        return _from_obj(json.loads(text))
    except json.JSONDecodeError:
        start = text.find("[")
        end = text.rfind("]")
        if start != -1 and end > start and end > start:
            return _from_obj(json.loads(text[start : end + 1]))
        raise


def _fallback_recommendations(failed: list[dict[str, str]]) -> list[str]:
    ranked = sorted(failed, key=lambda x: -int(x["risk_points"]))
    closers = [
        "Assign an owner and a target date to close this gap.",
        "Document the control you want, then verify it monthly.",
        "Review with your team quarterly and update your safety checklist.",
    ]
    recs: list[str] = []
    for idx, item in enumerate(ranked[:3]):
        closer = closers[min(idx, len(closers) - 1)]
        recs.append(
            f"Priority: {item['text']} (risk points: {item['risk_points']}). "
            f"{item['risk_context']} {closer}"
        )
    fillers = [
        "Tie open items to everyday impact so fixes get priority.",
        "Write down who is responsible for each fix and check progress weekly.",
        "After changes, run this check again to confirm risk went down.",
    ]
    i = 0
    while len(recs) < 3:
        recs.append(fillers[i % len(fillers)])
        i += 1
    return recs[:3]


def _gemini_three_recommendations(failed: list[dict[str, str]]) -> list[str]:
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

    prompt = f"""You are an expert cybersecurity coach writing for small businesses (8th-grade reading level). The user chose weaker answers on these topics:
{failed_block}

Generate exactly 3 specific, friendly, actionable recommendations as a JSON array of strings only. No markdown fences.

Output only valid JSON (array of strings)."""

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

    recs = _parse_json_array_of_strings(raw)
    if len(recs) < 3:
        raise ValueError(f"Expected 3 recommendations, got {len(recs)}.")
    return recs[:3]


def _recommendations_for_failed(failed: list[dict[str, str]]) -> tuple[list[str], str, str | None]:
    """Returns (recommendations, source, provider_error). provider_error set when key exists but Gemini failed."""
    key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if key:
        try:
            return _gemini_three_recommendations(failed), "gemini", None
        except Exception as exc:  # noqa: BLE001
            logger.warning("Gemini recommendations failed; using built-in fallback: %s", exc)
            return _fallback_recommendations(failed), "fallback", str(exc)
    return _fallback_recommendations(failed), "fallback", None


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
    ai_recommendations: list[str]
    recommendation_source: str | None = None  # "gemini" | "fallback" | None when no gaps
    ai_provider_error: str | None = None  # set when key present but Gemini failed


class DomainScanRequest(BaseModel):
    domain: str


app = FastAPI(title="ClearRisk Assessment API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
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

        ai_recommendations, source, provider_err = _recommendations_for_failed(failed)
        ai_recommendations = [str(r).strip() for r in ai_recommendations if str(r).strip()]
        if not ai_recommendations:
            ai_recommendations = _fallback_recommendations(failed)
            source = "fallback"
            if provider_err is None and (os.environ.get("GEMINI_API_KEY") or "").strip():
                provider_err = "Empty recommendation list after Gemini response."

        return AnalyzeResponse(
            overall_risk_score=float(posture),
            risk_total=float(risk_total),
            risk_band=band,
            risk_band_message=band_msg,
            ai_recommendations=ai_recommendations,
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
        return scan_domain(body.domain)
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
    """Whether Gemini is configured (never exposes the API key)."""
    key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    return {
        "gemini_api_key_configured": bool(key),
        "gemini_api_key_length": len(key),
        "gemini_model": (os.environ.get("GEMINI_MODEL") or "gemini-2.5-flash").strip(),
    }
