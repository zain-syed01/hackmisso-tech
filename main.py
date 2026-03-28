from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, RootModel, field_validator

MAX_SCORE = 2000

ASSESSMENT_DATA: dict[str, dict[str, Any]] = {
    "q1_mfa": {
        "points": {"opt0": 0, "opt1": 50, "opt2": 100},
        "text": "Do users have Multi-Factor Authentication (MFA) enabled?",
        "risk_context": "Credential theft and account takeover.",
    },
    "q2_remote": {
        "points": {"opt0": 0, "opt1": 50, "opt2": 100},
        "text": "How is remote network access secured?",
        "risk_context": "Unsecured RDP or VPN access.",
    },
    "q3_privilege": {
        "points": {"opt0": 0, "opt1": 50, "opt2": 100},
        "text": "Are administrative rights restricted to necessary personnel only?",
        "risk_context": "Excessive privileges leading to insider threats or malware spread.",
    },
    "q4_offboarding": {
        "points": {"opt0": 0, "opt1": 50, "opt2": 100},
        "text": "Are access rights revoked immediately when an employee leaves?",
        "risk_context": "Former employee unauthorized access.",
    },
    "q5_encryption_rest": {
        "points": {"opt0": 0, "opt1": 50, "opt2": 100},
        "text": "Are hard drives on company laptops fully encrypted?",
        "risk_context": "Data theft from lost or stolen physical devices.",
    },
    "q6_encryption_transit": {
        "points": {"opt0": 0, "opt1": 50, "opt2": 100},
        "text": "Is sensitive data encrypted when shared over email or file transfers?",
        "risk_context": "Interception of sensitive data in transit.",
    },
    "q7_backup_freq": {
        "points": {"opt0": 0, "opt1": 50, "opt2": 100},
        "text": "Are critical systems and data backed up automatically?",
        "risk_context": "Data loss from hardware failure or ransomware.",
    },
    "q8_backup_test": {
        "points": {"opt0": 0, "opt1": 50, "opt2": 100},
        "text": "How often are backups tested for successful restoration?",
        "risk_context": "Corrupted backups failing during an emergency.",
    },
    "q9_irp": {
        "points": {"opt0": 0, "opt1": 50, "opt2": 100},
        "text": "Do you have a written Incident Response Plan (IRP)?",
        "risk_context": "Delayed and disorganized response to active breaches.",
    },
    "q10_logs": {
        "points": {"opt0": 0, "opt1": 50, "opt2": 100},
        "text": "Are system and network logs retained and reviewed?",
        "risk_context": "Inability to perform forensic analysis after an attack.",
    },
    "q11_training": {
        "points": {"opt0": 0, "opt1": 50, "opt2": 100},
        "text": "How frequently do employees undergo security awareness training?",
        "risk_context": "Human error and susceptibility to social engineering.",
    },
    "q12_phishing": {
        "points": {"opt0": 0, "opt1": 50, "opt2": 100},
        "text": "Do you conduct simulated phishing tests on employees?",
        "risk_context": "Inability to spot targeted phishing emails.",
    },
    "q13_reporting": {
        "points": {"opt0": 0, "opt1": 50, "opt2": 100},
        "text": "Is there a clear, known process for employees to report suspicious activity?",
        "risk_context": "Unreported security incidents escalating quietly.",
    },
    "q14_vendor": {
        "points": {"opt0": 0, "opt1": 50, "opt2": 100},
        "text": "Do you assess the security posture of third-party vendors?",
        "risk_context": "Supply chain attacks originating from vendor networks.",
    },
    "q15_shadow_it": {
        "points": {"opt0": 0, "opt1": 50, "opt2": 100},
        "text": "Do you control and monitor the use of unsanctioned cloud apps?",
        "risk_context": "Data leakage through unapproved third-party applications.",
    },
    "q16_patching": {
        "points": {"opt0": 0, "opt1": 50, "opt2": 100},
        "text": "Are operating systems and third-party applications updated automatically?",
        "risk_context": "Exploitation of known software vulnerabilities.",
    },
    "q17_edr": {
        "points": {"opt0": 0, "opt1": 50, "opt2": 100},
        "text": "Are endpoints protected by modern Antivirus or EDR software?",
        "risk_context": "Malware and ransomware executing freely on workstations.",
    },
    "q18_wifi": {
        "points": {"opt0": 0, "opt1": 50, "opt2": 100},
        "text": "Is the corporate Wi-Fi network segmented from guest access?",
        "risk_context": "Unauthorized users sniffing traffic or accessing internal servers.",
    },
    "q19_physical": {
        "points": {"opt0": 0, "opt1": 50, "opt2": 100},
        "text": "Is physical access to servers and network equipment restricted?",
        "risk_context": "Physical tampering or hardware theft.",
    },
    "q20_bcp": {
        "points": {"opt0": 0, "opt1": 50, "opt2": 100},
        "text": "Do you have a Business Continuity Plan to operate during an outage?",
        "risk_context": "Prolonged operational downtime and revenue loss.",
    },
}

logger = logging.getLogger(__name__)


def _extract_gemini_text(response: Any) -> str:
    """Safely read text from a GenerateContentResponse (`.text` can raise if blocked/empty)."""
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
    """Questions where the selected option scored less than 100."""
    failed: list[dict[str, str]] = []
    for qid in sorted(ASSESSMENT_DATA.keys()):
        opt_id = answers[qid]
        pts = ASSESSMENT_DATA[qid]["points"][opt_id]
        if pts < 100:
            q = ASSESSMENT_DATA[qid]
            failed.append(
                {
                    "id": qid,
                    "text": q["text"],
                    "risk_context": q["risk_context"],
                    "points_earned": str(pts),
                }
            )
    return failed


def _parse_json_array_of_strings(raw: str) -> list[str]:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```\s*$", "", text)
    data = json.loads(text)
    if not isinstance(data, list):
        raise ValueError("Response is not a JSON array")
    out: list[str] = []
    for item in data:
        s = str(item).strip()
        if s:
            out.append(s)
    return out


def _fallback_recommendations(failed: list[dict[str, str]]) -> list[str]:
    """Deterministic recommendations when Gemini is unavailable or fails. Always returns 3 strings."""
    ranked = sorted(failed, key=lambda x: int(x["points_earned"]))
    closers = [
        "Assign a named owner, target dates, and verify completion.",
        "Document the desired end state, then track remediation in your risk register.",
        "Review progress with leadership quarterly and adjust priorities as threats change.",
    ]
    recs: list[str] = []
    for idx, item in enumerate(ranked[:3]):
        closer = closers[min(idx, len(closers) - 1)]
        recs.append(
            f"Strengthen: {item['text']} (score {item['points_earned']}/100). "
            f"Exposure includes {item['risk_context']} {closer}"
        )
    fillers = [
        "Tie open gaps to business impact and fund remediation in order of severity.",
        "Map each open item to an owner in your risk register with measurable outcomes.",
        "Schedule a follow-up assessment after remediation to confirm controls hold.",
    ]
    i = 0
    while len(recs) < 3:
        recs.append(fillers[i % len(fillers)])
        i += 1
    return recs[:3]


def _gemini_three_recommendations(failed: list[dict[str, str]]) -> list[str]:
    """Call Gemini; return exactly 3 strings. Raises on failure."""
    import google.generativeai as genai  # noqa: PLC0415

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY not set")

    genai.configure(api_key=api_key)
    model_name = os.environ.get("GEMINI_MODEL", "gemini-1.5-flash")
    model = genai.GenerativeModel(model_name)

    failed_lines = []
    for item in failed:
        failed_lines.append(
            f"- {item['text']} (score {item['points_earned']}/100 on this control). Risk: {item['risk_context']}"
        )
    failed_block = "\n".join(failed_lines)

    prompt = f"""You are an expert cybersecurity consultant. The user failed these security checks:
{failed_block}

Generate exactly 3 specific, actionable, and prioritized security recommendations in plain English. Explain the risks clearly. Format as a JSON array of strings.

Output only valid JSON (a JSON array of strings), with no markdown fences or other text."""

    response = model.generate_content(prompt)
    raw = _extract_gemini_text(response)
    if not raw:
        raise ValueError("Gemini returned an empty or blocked response.")

    recs = _parse_json_array_of_strings(raw)
    if len(recs) < 3:
        raise ValueError(f"Expected 3 recommendations, got {len(recs)}.")
    return recs[:3]


def _recommendations_for_failed(failed: list[dict[str, str]]) -> tuple[list[str], str]:
    """Returns (recommendations, source) where source is 'gemini' or 'fallback'."""
    if os.environ.get("GEMINI_API_KEY"):
        try:
            return _gemini_three_recommendations(failed), "gemini"
        except Exception:  # noqa: BLE001
            pass
    return _fallback_recommendations(failed), "fallback"


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
    ai_recommendations: list[str]
    recommendation_source: str | None = None


app = FastAPI(title="RoostGuard Assessment API")

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

        total_score = 0
        for qid in sorted(expected_ids):
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
            total_score += int(pts_map[opt_id])

        overall_risk_score = round((total_score / MAX_SCORE) * 100.0, 2)

        failed = _failed_checks(answers)
        if not failed:
            return AnalyzeResponse(
                overall_risk_score=overall_risk_score,
                ai_recommendations=[],
                recommendation_source=None,
            )

        ai_recommendations, source = _recommendations_for_failed(failed)
        ai_recommendations = [str(r).strip() for r in ai_recommendations if str(r).strip()]
        if not ai_recommendations:
            ai_recommendations = _fallback_recommendations(failed)
            source = "fallback"

        return AnalyzeResponse(
            overall_risk_score=float(overall_risk_score),
            ai_recommendations=ai_recommendations,
            recommendation_source=source,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("POST /api/analyze failed")
        raise HTTPException(
            status_code=500,
            detail=f"Server error during analysis: {exc!s}. Check the uvicorn terminal for the full traceback.",
        ) from exc


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
