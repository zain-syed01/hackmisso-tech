import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ASSESSMENT_DATA, ASSESSMENT_META, MAX_RAW_RISK, QUESTION_ORDER } from "./assessmentData.js";
import { parseRecommendationText } from "./recommendationUtils.js";
import { downloadAssessmentPdf } from "./pdfExport.js";

const REPORT_STORAGE_KEY = "clearrisk_last_report";
const DOMAIN_SCAN_URL = "/api/domain-scan";

/** Same-origin `/api` via Vite proxy → `http://127.0.0.1:8000`. Override with `VITE_API_URL` if needed. */
const API_URL = import.meta.env.VITE_API_URL?.trim() || "/api/analyze";

function formatApiErrorDetail(status, data) {
  const d = data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d
      .map((e) => (typeof e === "object" && e != null && "msg" in e ? e.msg : JSON.stringify(e)))
      .join(" ");
  }
  if (d != null && typeof d === "object") return JSON.stringify(d);
  return `Request failed (HTTP ${status})`;
}

function buildEmptyAnswers() {
  return QUESTION_ORDER.reduce((acc, qid) => {
    acc[qid] = "";
    return acc;
  }, {});
}

function getPostureTier(score) {
  if (score >= 80) return "strong";
  if (score >= 40) return "elevated";
  return "critical";
}

function tierLabel(tier) {
  if (tier === "strong") return "Strong posture";
  if (tier === "elevated") return "Elevated exposure";
  return "Critical exposure";
}

const stepVariants = {
  initial: { opacity: 0, x: 28 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -28 },
};

const easeOut = [0.16, 1, 0.3, 1];

function LoadingOverlay() {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#070b12]/92 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="relative flex h-48 w-48 items-center justify-center">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="absolute rounded-full border border-cyan-400/40"
            style={{ width: 80 + i * 36, height: 80 + i * 36 }}
            animate={{
              scale: [1, 1.08, 1],
              opacity: [0.35, 0.9, 0.35],
            }}
            transition={{
              duration: 1.6,
              repeat: Infinity,
              delay: i * 0.2,
              ease: "easeInOut",
            }}
          />
        ))}
        <motion.div
          className="relative z-10 flex h-20 w-20 items-center justify-center rounded-2xl border border-cyan-400/30 bg-gradient-to-br from-cyan-500/20 to-emerald-500/10 shadow-[0_0_40px_rgba(34,211,238,0.25)]"
          animate={{ boxShadow: ["0 0 24px rgba(34,211,238,0.2)", "0 0 56px rgba(34,211,238,0.45)", "0 0 24px rgba(34,211,238,0.2)"] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        >
          <span className="text-2xl font-bold tracking-tight text-cyan-300">CR</span>
        </motion.div>
      </div>
      <motion.p
        className="mt-8 text-center text-sm font-medium text-slate-400 animate-pulse"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
      >
        Generating intelligence…
      </motion.p>
      <p className="mt-1 text-sm text-slate-500">ClearRisk is analyzing your responses</p>
      <div className="mt-8 flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-2 w-2 rounded-full bg-cyan-400"
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1.1, 0.85] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
      </div>
    </motion.div>
  );
}

function RecommendationCard({ text, index, source }) {
  const parsed = parseRecommendationText(text, source);

  if (parsed.mode === "prose") {
    return (
      <motion.article
        className="rounded-xl border border-slate-700/60 bg-slate-950/50 p-5"
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.55 + index * 0.06, duration: 0.35 }}
      >
        <div className="flex gap-4">
          <span className="font-mono text-sm font-bold text-cyan-500/90">{String(index + 1).padStart(2, "0")}</span>
          <p className="text-sm leading-relaxed text-slate-300">{parsed.body}</p>
        </div>
      </motion.article>
    );
  }

  const { question, score, risk, action } = parsed;
  return (
    <motion.article
      className="rounded-xl border border-slate-700/60 bg-slate-950/50 p-5"
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.55 + index * 0.06, duration: 0.35 }}
    >
      <div className="flex gap-4">
        <span className="shrink-0 font-mono text-sm font-bold text-cyan-500/90">{String(index + 1).padStart(2, "0")}</span>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Control gap</p>
            <p className="mt-1 text-base font-semibold leading-snug text-white">{question}</p>
            {score !== null && (
              <p className="mt-2 inline-flex rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-200/90">
                Risk points (this answer): {score}
              </p>
            )}
          </div>
          <div className="border-t border-slate-700/50 pt-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-red-300/80">Risk exposure</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-400">{risk}</p>
          </div>
          {action && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/90">Recommended action</p>
              <p className="mt-1 text-sm font-medium leading-relaxed text-emerald-100/90">{action}</p>
            </div>
          )}
        </div>
      </div>
    </motion.article>
  );
}

function ScoreDashboard({
  score,
  recommendations,
  recommendationSource = null,
  riskTotal = null,
  riskBand = null,
  riskBandMessage = null,
  aiProviderError = null,
}) {
  const tier = getPostureTier(score);
  const tiers = [
    { id: "critical", label: "Critical", sub: "< 40%", color: "rgb(248 113 113)", bg: "rgba(248,113,113,0.12)" },
    { id: "elevated", label: "Elevated", sub: "40 – 79%", color: "rgb(250 204 21)", bg: "rgba(250,204,21,0.08)" },
    { id: "strong", label: "Strong", sub: "80%+", color: "rgb(52 211 153)", bg: "rgba(52,211,153,0.12)" },
  ];

  return (
    <motion.div
      className="mx-auto w-full max-w-3xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <div className="relative overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/80 p-8 shadow-[0_0_0_1px_rgba(148,163,184,0.06)] backdrop-blur-xl">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl" />

        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400/90">Risk score dashboard</p>
          <h2 className="mt-2 font-sans text-2xl font-bold tracking-tight text-white md:text-3xl">Posture overview</h2>
          <p className="mt-1 text-sm text-slate-400">
            {ASSESSMENT_META.title}. Posture score (higher is safer) from {QUESTION_ORDER.length} questions; raw risk
            index {riskTotal != null ? Math.round(riskTotal) : "—"} / {MAX_RAW_RISK} (lower is better).
            {riskBand ? (
              <>
                {" "}
                <span className="text-slate-300">Band: {riskBand}</span>
                {riskBandMessage ? <span className="text-slate-500"> — {riskBandMessage}</span> : null}
              </>
            ) : null}
          </p>

          <div className="mt-8 grid grid-cols-3 gap-3 md:gap-4">
            {tiers.map((t, i) => {
              const active = t.id === tier;
              return (
                <motion.div
                  key={t.id}
                  className="relative rounded-xl border px-3 py-4 text-center md:px-4"
                  style={{
                    borderColor: active ? t.color : "rgba(51,65,85,0.6)",
                    backgroundColor: active ? t.bg : "rgba(15,23,42,0.5)",
                  }}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    scale: active ? 1.02 : 1,
                    boxShadow: active ? `0 0 32px ${t.color}33` : "none",
                  }}
                  transition={{ delay: 0.08 * i, duration: 0.45, ease: easeOut }}
                >
                  {active && (
                    <motion.span
                      className="absolute inset-0 rounded-xl"
                      style={{ boxShadow: `inset 0 0 20px ${t.color}22` }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.5 }}
                    />
                  )}
                  <span
                    className="relative block text-[10px] font-bold uppercase tracking-wider md:text-xs"
                    style={{ color: t.color }}
                  >
                    {t.label}
                  </span>
                  <span className="relative mt-1 block text-[10px] text-slate-500 md:text-xs">{t.sub}</span>
                  {active && (
                    <motion.span
                      className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-900"
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 400, damping: 18, delay: 0.15 + i * 0.05 }}
                    >
                      ✓
                    </motion.span>
                  )}
                </motion.div>
              );
            })}
          </div>

          <motion.div
            className="mt-10 flex flex-col items-center justify-center gap-2"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.35, duration: 0.55, ease: easeOut }}
          >
            <div
              className="bg-gradient-to-br from-white to-slate-200 bg-clip-text pb-2 text-7xl font-extrabold text-transparent tabular-nums md:text-8xl"
              style={{ animation: "score-pop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) forwards" }}
            >
              {score}%
            </div>
            <p className="text-sm font-medium text-slate-300">{tierLabel(tier)}</p>
          </motion.div>

          <div className="relative mt-10 h-4 w-full overflow-hidden rounded-full bg-slate-800/90">
            <div
              className="absolute inset-0 opacity-90"
              style={{
                background: "linear-gradient(90deg, rgb(248 113 113) 0%, rgb(250 204 21) 50%, rgb(52 211 153) 100%)",
              }}
            />
            <motion.div
              className="absolute top-1/2 z-10 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-900 shadow-[0_0_20px_rgba(255,255,255,0.4)]"
              initial={{ left: "0%" }}
              animate={{ left: `${Math.min(100, Math.max(0, score))}%` }}
              transition={{ delay: 0.5, duration: 0.9, ease: easeOut }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[10px] font-medium uppercase tracking-wide text-slate-500">
            <span>Weaker</span>
            <span>Stronger</span>
          </div>
        </div>
      </div>

      {recommendations.length > 0 ? (
        <motion.div
          className="mt-8 rounded-2xl border border-slate-700/80 bg-slate-900/50 p-6 backdrop-blur-sm"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.4 }}
        >
          {aiProviderError && (
            <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-950/35 px-4 py-3 text-sm text-amber-100/95">
              <p className="font-semibold text-amber-200">Gemini was not used for these recommendations</p>
              <p className="mt-1 text-xs leading-relaxed text-amber-100/80">{aiProviderError}</p>
              <p className="mt-2 text-xs text-amber-200/70">
                Fix: put a valid key in a <code className="rounded bg-black/30 px-1">.env</code> file as{" "}
                <code className="rounded bg-black/30 px-1">GEMINI_API_KEY=...</code>, restart uvicorn, then run{" "}
                <code className="rounded bg-black/30 px-1">python scripts/verify_gemini.py</code>.
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-emerald-400/90">Security recommendations</h3>
            {recommendationSource === "gemini" && (
              <span
                className="cursor-help rounded-full border border-violet-400/40 bg-violet-500/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200"
                title="Generated with Google Gemini (e.g. gemini-2.5-flash when GEMINI_MODEL is set on the server)."
              >
                Gemini
              </span>
            )}
            {recommendationSource === "fallback" && (
              <span
                className="cursor-help rounded-full border border-slate-500/50 bg-slate-800/80 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
                title={
                  aiProviderError
                    ? "Gemini failed; see the warning above. Fix the key and restart the API."
                    : "No GEMINI_API_KEY on the server. Add .env with your key, restart uvicorn, run python scripts/verify_gemini.py, then analyze again."
                }
              >
                Built-in
              </span>
            )}
          </div>
          <div className="mt-5 space-y-4">
            {recommendations.slice(0, 3).map((rec, i) => (
              <RecommendationCard key={i} text={rec} index={i} source={recommendationSource} />
            ))}
          </div>
        </motion.div>
      ) : (
        score >= 100 && (
          <motion.p
            className="mt-8 rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-4 py-3 text-center text-sm text-emerald-200/90"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            All controls at full strength. Sustain monitoring and periodic reassessment.
          </motion.p>
        )
      )}
    </motion.div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState("home");
  const [answers, setAnswers] = useState(buildEmptyAnswers);
  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState("wizard");
  const [lastReport, setLastReport] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [importMessage, setImportMessage] = useState(null);
  const [domainInput, setDomainInput] = useState("");
  const [domainScanLoading, setDomainScanLoading] = useState(false);
  const [domainScanError, setDomainScanError] = useState(null);
  const [domainScanResult, setDomainScanResult] = useState(null);

  const totalQuestions = QUESTION_ORDER.length;
  const reviewStepIndex = totalQuestions;
  const maxStep = reviewStepIndex;

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(REPORT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.score === "number") {
          setLastReport(parsed);
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  const answeredCount = useMemo(
    () => QUESTION_ORDER.filter((qid) => answers[qid] !== "").length,
    [answers]
  );

  const currentQid = stepIndex < totalQuestions ? QUESTION_ORDER[stepIndex] : null;
  const currentQuestion = currentQid ? ASSESSMENT_DATA[currentQid] : null;

  const progressPercent =
    stepIndex < totalQuestions
      ? Math.round(((stepIndex + 1) / totalQuestions) * 100)
      : 100;

  const canGoNext = currentQid ? answers[currentQid] !== "" : false;
  const canSubmitReview = answeredCount === totalQuestions;

  function persistReport(report) {
    setLastReport(report);
    try {
      sessionStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify(report));
    } catch {
      /* ignore */
    }
  }

  async function runAnalysis() {
    setSubmitting(true);
    setError(null);
    setPhase("loading");

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(answers),
      });

      const rawText = await res.text();
      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error(
          rawText
            ? `API did not return JSON (HTTP ${res.status}): ${rawText.slice(0, 280)}`
            : `Empty response (HTTP ${res.status})`
        );
      }

      if (!res.ok) {
        throw new Error(formatApiErrorDetail(res.status, data));
      }

      const score = data.overall_risk_score;
      const recs = Array.isArray(data.ai_recommendations) ? data.ai_recommendations : [];
      const src = data.recommendation_source ?? null;

      setPhase("wizard");
      setStepIndex(0);
      persistReport({
        score,
        riskTotal: typeof data.risk_total === "number" ? data.risk_total : null,
        riskBand: typeof data.risk_band === "string" ? data.risk_band : null,
        riskBandMessage: typeof data.risk_band_message === "string" ? data.risk_band_message : null,
        recommendations: recs,
        recommendationSource: src,
        aiProviderError: typeof data.ai_provider_error === "string" ? data.ai_provider_error : null,
        answers: { ...answers },
        savedAt: new Date().toISOString(),
      });
      setActiveTab("report");
    } catch (err) {
      let message = err instanceof Error ? err.message : "Something went wrong.";
      if (err instanceof TypeError && String(message).toLowerCase().includes("fetch")) {
        message =
          "Could not reach the API. Start the FastAPI server in another terminal: cd to the folder that contains main.py, then run: uvicorn main:app --reload --port 8000";
      }
      setError(message);
      setPhase("wizard");
      setStepIndex(reviewStepIndex);
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setAnswers(buildEmptyAnswers());
    setStepIndex(0);
    setPhase("wizard");
    setLastReport(null);
    setError(null);
    try {
      sessionStorage.removeItem(REPORT_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setActiveTab("home");
  }

  function exportPdf() {
    const exportedAt = new Date().toISOString();
    downloadAssessmentPdf({ answers, lastReport, exportedAt });
    setImportMessage("PDF downloaded.");
  }

  function exportJsonBackup() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      answers,
      lastReport,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clearrisk-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setImportMessage("JSON backup downloaded.");
  }

  async function runDomainScan(e) {
    e.preventDefault();
    setDomainScanError(null);
    setDomainScanResult(null);
    const d = domainInput.trim();
    if (!d) {
      setDomainScanError("Enter a domain (e.g. example.com).");
      return;
    }
    setDomainScanLoading(true);
    try {
      const res = await fetch(DOMAIN_SCAN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: d }),
      });
      const rawText = await res.text();
      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error(
          rawText
            ? `API did not return JSON (HTTP ${res.status}): ${rawText.slice(0, 280)}`
            : `Empty response (HTTP ${res.status})`
        );
      }
      if (!res.ok) {
        throw new Error(formatApiErrorDetail(res.status, data));
      }
      setDomainScanResult(data);
    } catch (err) {
      let message = err instanceof Error ? err.message : "Scan failed.";
      if (err instanceof TypeError && String(message).toLowerCase().includes("fetch")) {
        message =
          "Could not reach the API. Start the FastAPI server (uvicorn main:app --reload --port 8000) and try again.";
      }
      setDomainScanError(message);
    } finally {
      setDomainScanLoading(false);
    }
  }

  function importState(file) {
    setImportMessage(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.answers && typeof data.answers === "object") {
          const next = buildEmptyAnswers();
          for (const qid of QUESTION_ORDER) {
            if (data.answers[qid]) next[qid] = data.answers[qid];
          }
          setAnswers(next);
        }
        if (data.lastReport && typeof data.lastReport.score === "number") {
          persistReport(data.lastReport);
        }
        setImportMessage("Import applied.");
        setActiveTab("questionnaire");
      } catch {
        setImportMessage("Invalid JSON file.");
      }
    };
    reader.readAsText(file);
  }

  function setOption(questionId, optionId) {
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
  }

  function goNext() {
    if (stepIndex < totalQuestions - 1) {
      if (!canGoNext) return;
      setStepIndex((s) => s + 1);
    } else if (stepIndex === totalQuestions - 1) {
      if (!canGoNext) return;
      setStepIndex(reviewStepIndex);
    }
  }

  function goBack() {
    if (stepIndex > 0) setStepIndex((s) => s - 1);
  }

  const reportScore = lastReport?.score ?? null;
  const reportDisplayScore =
    reportScore !== null ? Math.round(reportScore * 10) / 10 : null;

  const navBtn =
    "rounded-lg px-3 py-2 text-sm font-medium transition-colors md:px-4 border border-transparent";
  const navActive = "border-cyan-500/40 bg-cyan-500/10 text-cyan-200";
  const navIdle = "text-slate-400 hover:border-slate-600 hover:bg-slate-800/50 hover:text-slate-200";

  return (
    <div className="relative mx-auto min-h-screen max-w-6xl px-4 pb-16 pt-8 md:px-8 md:pt-12">
      <header className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/25 bg-gradient-to-br from-cyan-500/20 to-emerald-600/10">
            <span className="text-sm font-extrabold tracking-tight text-cyan-300">CR</span>
          </div>
          <div>
            <h1 className="font-sans text-xl font-bold tracking-tight text-white md:text-2xl">ClearRisk</h1>
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500">Security posture platform</p>
          </div>
        </div>
        <nav className="flex flex-wrap gap-2">
          {[
            ["home", "Home"],
            ["questionnaire", "Questionnaire"],
            ["report", "Report"],
            ["domain", "Domain scan"],
            ["data", "Import / export"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`${navBtn} ${activeTab === id ? navActive : navIdle}`}
              onClick={() => setActiveTab(id)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={handleReset}
            className="rounded-lg border border-slate-600/80 bg-slate-800/50 px-3 py-2 text-sm font-medium text-slate-300 hover:border-slate-500 hover:bg-slate-800"
          >
            Reset all
          </button>
        </nav>
      </header>

      <AnimatePresence mode="wait">
        {phase === "loading" && <LoadingOverlay key="loading" />}
      </AnimatePresence>

      {activeTab === "home" && (
        <motion.section
          className="mx-auto max-w-4xl"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <h2 className="text-center font-sans text-3xl font-bold text-white md:text-4xl">Welcome</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm text-slate-400 md:text-base">
            Baseline your organization with a structured questionnaire, view a scored report, and export or restore assessments when you need them.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {[
              {
                t: "Questionnaire",
                d: "20 cyber-safety questions (A–D answers) with review before analysis.",
                tab: "questionnaire",
                icon: "📋",
              },
              {
                t: "Domain scan",
                d: "DNS, mail (MX), SPF & DMARC, HTTPS/TLS, HSTS, and HTTP→HTTPS redirect checks.",
                tab: "domain",
                icon: "🔍",
              },
              {
                t: "Report",
                d: "Posture score, R/Y/G band, and three prioritized recommendations after analysis.",
                tab: "report",
                icon: "📊",
              },
              {
                t: "Import / export",
                d: "Download a PDF report or restore a saved JSON backup (answers + last report).",
                tab: "data",
                icon: "⏎",
              },
            ].map((card) => (
              <button
                key={card.t}
                type="button"
                onClick={() => setActiveTab(card.tab)}
                className="rounded-2xl border border-slate-700/80 bg-slate-900/70 p-6 text-left shadow-lg transition-all duration-300 hover:border-cyan-500/30 hover:shadow-cyan-500/5"
              >
                <span className="text-2xl">{card.icon}</span>
                <h3 className="mt-3 font-sans text-lg font-bold text-white">{card.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{card.d}</p>
              </button>
            ))}
          </div>
          <p className="mt-10 text-center text-xs text-slate-600">
            Assessment data in ClearRisk stays in this browser session unless you export it.
          </p>
        </motion.section>
      )}

      {activeTab === "questionnaire" && phase === "wizard" && (
        <>
          <div className="mb-8 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400/80">Assessment</p>
            <h2 className="mt-2 font-sans text-3xl font-bold tracking-tight text-white md:text-4xl">Cybersecurity posture review</h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-400 md:text-base">
              Step through guided questions. ClearRisk maps your answers to a posture score, risk band, and recommendations.
            </p>
          </div>

          <div className="mb-8 max-w-2xl">
            <div className="mb-2 flex justify-between text-xs font-medium text-slate-500">
              <span>
                Step {Math.min(stepIndex + 1, maxStep + 1)} of {maxStep + 1}
              </span>
              <span>{progressPercent}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400"
                initial={false}
                animate={{ width: `${stepIndex >= totalQuestions ? 100 : progressPercent}%` }}
                transition={{ duration: 0.35, ease: easeOut }}
              />
            </div>
          </div>

          <div className="relative min-h-[320px] max-w-2xl">
            <AnimatePresence mode="wait">
              {stepIndex < totalQuestions && currentQuestion && (
                <motion.div
                  key={currentQid}
                  variants={stepVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.28, ease: easeOut }}
                  className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-6 shadow-xl shadow-black/20 backdrop-blur transition-all duration-300 ease-out md:p-8"
                >
                  <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400/90">Question {stepIndex + 1}</p>
                  <p className="mt-1 text-xs text-slate-500">{currentQuestion.category}</p>
                  <h3 className="mt-4 font-sans text-lg font-semibold leading-snug text-white md:text-xl">
                    {currentQuestion.text}
                  </h3>
                  <div className="mt-8">
                    <label className="sr-only" htmlFor="answer-select">
                      Answer
                    </label>
                    <select
                      id="answer-select"
                      className="w-full cursor-pointer appearance-none rounded-xl border border-slate-600/80 bg-slate-950/80 px-4 py-3.5 pr-10 text-sm font-medium text-slate-100 outline-none transition-all duration-300 ease-out hover:border-cyan-500/40 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                      value={answers[currentQid]}
                      onChange={(e) => setOption(currentQid, e.target.value)}
                    >
                      <option value="">Select an answer…</option>
                      {currentQuestion.options.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </motion.div>
              )}

              {stepIndex === reviewStepIndex && (
                <motion.div
                  key="review"
                  variants={stepVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.28, ease: easeOut }}
                  className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-6 shadow-xl transition-all duration-300 ease-out md:p-8"
                >
                  <p className="text-xs font-semibold uppercase tracking-wider text-cyan-400/90">Review</p>
                  <h3 className="mt-2 font-sans text-xl font-bold text-white">Confirm your responses</h3>
                  <p className="mt-1 text-sm text-slate-400">Verify selections before submitting to the analysis engine.</p>
                  <ul className="mt-6 max-h-[min(50vh,420px)] space-y-3 overflow-y-auto pr-1">
                    {QUESTION_ORDER.map((qid) => {
                      const q = ASSESSMENT_DATA[qid];
                      const opt = q.options.find((o) => o.id === answers[qid]);
                      return (
                        <li
                          key={qid}
                          className="flex flex-col gap-1 rounded-lg border border-slate-700/50 bg-slate-950/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{q.category}</span>
                          <span className="text-sm text-slate-200">{opt ? opt.label : "—"}</span>
                        </li>
                      );
                    })}
                  </ul>
                  {error && (
                    <motion.p
                      className="mt-4 rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-300"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                      {error}
                    </motion.p>
                  )}
                  <div className="mt-8 flex flex-wrap gap-3">
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 px-8 py-3.5 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-500/20 transition duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={!canSubmitReview || submitting}
                      onClick={() => runAnalysis()}
                    >
                      Run analysis
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {(stepIndex < reviewStepIndex || stepIndex === reviewStepIndex) && (
            <div className="mt-8 flex max-w-2xl flex-wrap items-center justify-between gap-4">
              <button
                type="button"
                onClick={goBack}
                disabled={stepIndex === 0}
                className="rounded-xl border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-300 transition duration-200 hover:bg-slate-800/80 disabled:cursor-not-allowed disabled:opacity-35"
              >
                Back
              </button>
              {stepIndex < reviewStepIndex && (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!canGoNext}
                  className="rounded-xl border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-300 transition duration-200 hover:bg-slate-800/80 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  {stepIndex === totalQuestions - 1 ? "Review" : "Next"}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {activeTab === "report" && (
        <motion.section
          className="mt-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
        >
          {reportDisplayScore !== null && lastReport ? (
            <>
              <ScoreDashboard
                score={reportDisplayScore}
                recommendations={lastReport.recommendations ?? []}
                recommendationSource={lastReport.recommendationSource ?? null}
                riskTotal={lastReport.riskTotal ?? null}
                riskBand={lastReport.riskBand ?? null}
                riskBandMessage={lastReport.riskBandMessage ?? null}
                aiProviderError={lastReport.aiProviderError ?? null}
              />
              {lastReport.savedAt && (
                <p className="mt-6 text-center text-xs text-slate-500">
                  Report saved {new Date(lastReport.savedAt).toLocaleString()}
                </p>
              )}
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setActiveTab("questionnaire")}
                  className="rounded-xl border border-slate-600 bg-slate-900/80 px-6 py-3 text-sm font-semibold text-slate-200 hover:border-cyan-500/40"
                >
                  Edit questionnaire
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="rounded-xl border border-slate-600 bg-slate-900/80 px-6 py-3 text-sm font-semibold text-slate-200 hover:border-cyan-500/40"
                >
                  New assessment
                </button>
              </div>
            </>
          ) : (
            <div className="mx-auto max-w-md rounded-2xl border border-slate-700/80 bg-slate-900/60 p-10 text-center">
              <p className="text-lg font-semibold text-white">No report yet</p>
              <p className="mt-2 text-sm text-slate-400">Complete the questionnaire and run analysis to generate your posture report.</p>
              <button
                type="button"
                onClick={() => setActiveTab("questionnaire")}
                className="mt-6 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 px-6 py-3 text-sm font-bold text-slate-950"
              >
                Start questionnaire
              </button>
            </div>
          )}
        </motion.section>
      )}

      {activeTab === "domain" && (
        <motion.section
          className="mx-auto max-w-3xl space-y-6"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="rounded-2xl border border-slate-700/80 bg-slate-900/70 p-8">
            <h2 className="font-sans text-2xl font-bold text-white">Domain scan</h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              Passive checks only: DNS (A, MX), SPF/DMARC TXT records, HTTPS/TLS reachability, HSTS, certificate horizon, and
              whether plain HTTP redirects toward HTTPS. No intrusive port scanning.
            </p>
            <form className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={runDomainScan}>
              <div className="min-w-0 flex-1">
                <label htmlFor="domain-input" className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Domain or URL
                </label>
                <input
                  id="domain-input"
                  type="text"
                  value={domainInput}
                  onChange={(ev) => setDomainInput(ev.target.value)}
                  placeholder="example.com"
                  className="mt-2 w-full rounded-xl border border-slate-600/80 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-500/50"
                  autoComplete="off"
                />
              </div>
              <button
                type="submit"
                disabled={domainScanLoading}
                className="rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 px-8 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {domainScanLoading ? "Scanning…" : "Run scan"}
              </button>
            </form>
            {domainScanError && (
              <p className="mt-4 rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">{domainScanError}</p>
            )}
          </div>

          {domainScanResult && (
            <div className="space-y-4 rounded-2xl border border-slate-700/80 bg-slate-900/50 p-8">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-cyan-400/90">Results</p>
                  <h3 className="mt-1 font-mono text-lg text-white">{domainScanResult.domain}</h3>
                </div>
                <div className="rounded-xl border border-slate-600 bg-slate-950/60 px-4 py-2 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Surface score</p>
                  <p className="text-3xl font-extrabold tabular-nums text-cyan-300">{domainScanResult.score}</p>
                  <p className="text-[10px] text-slate-500">0–100 (higher is better)</p>
                </div>
              </div>

              {Array.isArray(domainScanResult.issues) && domainScanResult.issues.length > 0 && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 px-4 py-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-amber-200/90">Findings</p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-amber-100/90">
                    {domainScanResult.issues.map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                {Array.isArray(domainScanResult.checks) &&
                  domainScanResult.checks.map((c) => (
                    <div
                      key={c.id}
                      className={`rounded-xl border px-4 py-3 text-sm ${
                        c.ok ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-100/90" : "border-slate-600 bg-slate-950/40 text-slate-300"
                      }`}
                    >
                      <span className="font-mono text-xs font-bold uppercase tracking-wide text-slate-500">{c.id}</span>
                      <p className="mt-1 break-words text-slate-200">{c.detail}</p>
                    </div>
                  ))}
              </div>

              {domainScanResult.a_records?.length > 0 && (
                <p className="text-xs text-slate-500">
                  <span className="font-semibold text-slate-400">A records:</span> {domainScanResult.a_records.join(", ")}
                </p>
              )}
            </div>
          )}
        </motion.section>
      )}

      {activeTab === "data" && (
        <motion.section
          className="mx-auto max-w-xl rounded-2xl border border-slate-700/80 bg-slate-900/70 p-8"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h2 className="font-sans text-2xl font-bold text-white">Import / export</h2>
          <p className="mt-2 text-sm text-slate-400">
            Export a PDF for sharing or archiving. Use a JSON backup if you want to import this assessment again in the browser later.
          </p>
          <button
            type="button"
            onClick={exportPdf}
            className="mt-6 w-full rounded-xl border border-cyan-500/40 bg-cyan-500/10 py-3 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/15"
          >
            Export PDF
          </button>
          <button
            type="button"
            onClick={exportJsonBackup}
            className="mt-3 w-full rounded-xl border border-slate-600 py-3 text-sm font-medium text-slate-300 hover:border-slate-500 hover:bg-slate-800/50"
          >
            JSON backup (for import)
          </button>
          <label className="mt-4 flex w-full cursor-pointer items-center justify-center rounded-xl border border-dashed border-slate-600 py-8 text-sm text-slate-400 hover:border-slate-500 hover:bg-slate-800/30">
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importState(f);
                e.target.value = "";
              }}
            />
            Choose file to import
          </label>
          {importMessage && <p className="mt-3 text-center text-sm text-slate-400">{importMessage}</p>}
        </motion.section>
      )}
    </div>
  );
}
