import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ASSESSMENT_DATA, QUESTION_ORDER } from "./assessmentData.js";
import { parseRecommendationText } from "./recommendationUtils.js";
import { downloadAssessmentPdf } from "./pdfExport.js";

const REPORT_STORAGE_KEY = "clearrisk_last_report";

/** Production: set `VITE_API_BASE` on Vercel to your FastAPI origin (no trailing slash), e.g. https://api-xxx.railway.app */
const rawApiBase = import.meta.env.VITE_API_BASE?.trim().replace(/\/$/, "") ?? "";
const legacyAnalyzeUrl = import.meta.env.VITE_API_URL?.trim() ?? "";
const API_URL = rawApiBase ? `${rawApiBase}/api/analyze` : legacyAnalyzeUrl || "/api/analyze";
const DOMAIN_SCAN_URL = rawApiBase
  ? `${rawApiBase}/api/domain-scan`
  : legacyAnalyzeUrl
    ? legacyAnalyzeUrl.replace(/\/api\/analyze\/?$/i, "/api/domain-scan")
    : "/api/domain-scan";

const hasRemoteApi = Boolean(rawApiBase) || Boolean(legacyAnalyzeUrl);

function missingProductionApiMessage() {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://your-app.vercel.app";
  return (
    "No backend URL is set for production. In Vercel → Project → Settings → Environment Variables, add VITE_API_BASE " +
    "with your Render API origin only (example: https://your-service.onrender.com), then click Redeploy. " +
    `On Render, set CORS_ALLOW_ORIGINS to ${origin} (https, no trailing slash).`
  );
}

const DOMAIN_SCAN_GROUP_ORDER = ["dns", "email_auth", "certificate", "header"];
const DOMAIN_SCAN_CHECK_ORDER = ["dns_a", "mx", "spf", "dmarc", "https", "tls_cert", "hsts", "http_to_https"];

function domainSurfaceScoreClass(score) {
  const n = Number(score);
  if (Number.isNaN(n)) return "text-cyan-300";
  if (n >= 80) return "text-emerald-300";
  if (n >= 55) return "text-amber-300";
  return "text-red-300";
}

/** Group passive scan checks for display; tolerates older API payloads without `group`. */
function buildDomainScanCheckGroups(checks, checkGroupsMeta) {
  if (!Array.isArray(checks) || checks.length === 0) return [];
  const orderIdx = (id) => {
    const i = DOMAIN_SCAN_CHECK_ORDER.indexOf(id);
    return i === -1 ? 999 : i;
  };
  const sorted = [...checks].sort((a, b) => {
    const ga = DOMAIN_SCAN_GROUP_ORDER.indexOf(a.group || "");
    const gb = DOMAIN_SCAN_GROUP_ORDER.indexOf(b.group || "");
    const gai = ga === -1 ? 99 : ga;
    const gbi = gb === -1 ? 99 : gb;
    if (gai !== gbi) return gai - gbi;
    return orderIdx(a.id) - orderIdx(b.id);
  });
  const titleMap = {
    dns: "DNS",
    email_auth: "Email authentication",
    certificate: "Certificate",
    header: "Headers",
  };
  if (Array.isArray(checkGroupsMeta)) {
    for (const m of checkGroupsMeta) {
      if (m?.id && m?.title) titleMap[m.id] = m.title;
    }
  }
  const out = [];
  for (const gid of DOMAIN_SCAN_GROUP_ORDER) {
    const items = sorted.filter((c) => (c.group || "") === gid);
    if (items.length) out.push({ id: gid, title: titleMap[gid] || gid, items });
  }
  const unmatched = sorted.filter((c) => !DOMAIN_SCAN_GROUP_ORDER.includes(c.group || ""));
  if (unmatched.length) out.push({ id: "_other", title: "Other", items: unmatched });
  return out;
}

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

const REC_SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

/** Tailwind-safe class strings for recommendation severity (most severe first in sort). */
const REC_SEVERITY_UI = {
  critical: {
    label: "Critical",
    border: "border-red-500/50",
    bg: "bg-red-950/35",
    badge: "border-red-400/45 bg-red-500/15 text-red-200",
    bar: "border-l-4 border-l-red-500",
  },
  high: {
    label: "High",
    border: "border-orange-500/45",
    bg: "bg-orange-950/30",
    badge: "border-orange-400/40 bg-orange-500/15 text-orange-200",
    bar: "border-l-4 border-l-orange-500",
  },
  medium: {
    label: "Medium",
    border: "border-amber-500/40",
    bg: "bg-amber-950/25",
    badge: "border-amber-400/35 bg-amber-500/12 text-amber-200",
    bar: "border-l-4 border-l-amber-500",
  },
  low: {
    label: "Low",
    border: "border-sky-500/40",
    bg: "bg-sky-950/25",
    badge: "border-sky-400/35 bg-sky-500/12 text-sky-200",
    bar: "border-l-4 border-l-sky-500",
  },
};

function normalizeRecommendationList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      if (typeof r === "string") {
        return { text: r, severity: "medium" };
      }
      const sev = String(r?.severity ?? "medium").toLowerCase();
      const sevOk = Object.prototype.hasOwnProperty.call(REC_SEVERITY_ORDER, sev) ? sev : "medium";
      return { text: String(r?.text ?? "").trim(), severity: sevOk };
    })
    .filter((r) => r.text.length > 0);
}

function sortRecommendationsBySeverity(items) {
  return [...items].sort((a, b) => REC_SEVERITY_ORDER[a.severity] - REC_SEVERITY_ORDER[b.severity]);
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
        Generating Report...
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

function RecommendationCard({ recommendation, index, source }) {
  const { text, severity } = recommendation;
  const theme = REC_SEVERITY_UI[severity] ?? REC_SEVERITY_UI.medium;
  const parsed = parseRecommendationText(text, source);

  if (parsed.mode === "prose") {
    return (
      <motion.article
        className={`rounded-xl border pl-5 pr-5 py-5 ${theme.border} ${theme.bg} ${theme.bar}`}
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.55 + index * 0.06, duration: 0.35 }}
      >
        <div className="flex flex-wrap items-start gap-3">
          <span className="font-mono text-sm font-bold text-cyan-500/90">{String(index + 1).padStart(2, "0")}</span>
          <span
            className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${theme.badge}`}
          >
            {theme.label}
          </span>
          <p className="min-w-0 flex-1 text-sm leading-relaxed text-slate-200">{parsed.body}</p>
        </div>
      </motion.article>
    );
  }

  const { question, score, risk, action } = parsed;
  return (
    <motion.article
      className={`rounded-xl border pl-5 pr-5 py-5 ${theme.border} ${theme.bg} ${theme.bar}`}
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.55 + index * 0.06, duration: 0.35 }}
    >
      <div className="flex gap-4">
        <span className="shrink-0 font-mono text-sm font-bold text-cyan-500/90">{String(index + 1).padStart(2, "0")}</span>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${theme.badge}`}
            >
              {theme.label}
            </span>
          </div>
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

function ScoreDashboard({ score, recommendations, recommendationSource = null, aiProviderError = null }) {
  const [severityFilter, setSeverityFilter] = useState(null);
  const [showAllSeverities, setShowAllSeverities] = useState(false);

  const sortedRecommendations = useMemo(
    () => sortRecommendationsBySeverity(normalizeRecommendationList(recommendations)),
    [recommendations]
  );

  const severityCounts = useMemo(() => {
    const c = { critical: 0, high: 0, medium: 0, low: 0 };
    sortedRecommendations.forEach((r) => {
      if (Object.prototype.hasOwnProperty.call(c, r.severity)) c[r.severity] += 1;
    });
    return c;
  }, [sortedRecommendations]);

  const filteredBySeverity = useMemo(() => {
    if (!severityFilter) return sortedRecommendations;
    return sortedRecommendations.filter((r) => r.severity === severityFilter);
  }, [sortedRecommendations, severityFilter]);

  const visibleRecommendations = useMemo(() => {
    if (severityFilter) return filteredBySeverity;
    if (showAllSeverities || filteredBySeverity.length <= 5) return filteredBySeverity;
    return filteredBySeverity.slice(0, 5);
  }, [filteredBySeverity, severityFilter, showAllSeverities]);

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

      {sortedRecommendations.length > 0 ? (
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
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            <span className="text-slate-400">Overall %</span> is your total result across all questions. Each card’s
            severity reflects how heavily <span className="text-slate-400">that gap</span> is weighted in the questionnaire
            (and is softened when your posture is already strong)—it does not mean your whole organization is in
            “critical” shape if the top score says otherwise.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Tap a severity to filter. Use Show more for the full list; most urgent items are listed first.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Filter:</span>
            {(["critical", "high", "medium", "low"]).map((k) => {
              const count = severityCounts[k];
              const active = severityFilter === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setSeverityFilter((prev) => (prev === k ? null : k));
                    setShowAllSeverities(false);
                  }}
                  className={`rounded-md border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${REC_SEVERITY_UI[k].badge} ${
                    active ? "ring-2 ring-white/80 ring-offset-2 ring-offset-slate-900" : "opacity-90 hover:opacity-100"
                  } ${count === 0 ? "cursor-not-allowed opacity-40 hover:opacity-40" : "cursor-pointer"}`}
                  disabled={count === 0}
                  title={count === 0 ? `No ${REC_SEVERITY_UI[k].label} items` : `Show only ${REC_SEVERITY_UI[k].label} (${count})`}
                >
                  {REC_SEVERITY_UI[k].label}
                  <span className="ml-1 tabular-nums opacity-80">({count})</span>
                </button>
              );
            })}
            {severityFilter && (
              <button
                type="button"
                onClick={() => {
                  setSeverityFilter(null);
                  setShowAllSeverities(false);
                }}
                className="rounded-md border border-slate-500/60 bg-slate-800/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-300 hover:bg-slate-700/80"
              >
                Clear filter
              </button>
            )}
          </div>
          {severityFilter && (
            <p className="mt-2 text-xs text-slate-400">
              Showing {filteredBySeverity.length} {REC_SEVERITY_UI[severityFilter].label.toLowerCase()} recommendation
              {filteredBySeverity.length === 1 ? "" : "s"}.
            </p>
          )}
          <div className="mt-5 space-y-4">
            {visibleRecommendations.map((rec, i) => (
              <RecommendationCard
                key={`${rec.severity}-${i}-${rec.text.slice(0, 24)}`}
                recommendation={rec}
                index={i}
                source={recommendationSource}
              />
            ))}
          </div>
          {!severityFilter && sortedRecommendations.length > 5 && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {!showAllSeverities ? (
                <button
                  type="button"
                  onClick={() => setShowAllSeverities(true)}
                  className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-6 py-2.5 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/15"
                >
                  Show more ({sortedRecommendations.length - 5} more)
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAllSeverities(false)}
                  className="rounded-xl border border-slate-600 bg-slate-800/80 px-6 py-2.5 text-sm font-semibold text-slate-200 hover:border-slate-500"
                >
                  Show less
                </button>
              )}
            </div>
          )}
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
  /** When true (from Report → Edit questionnaire), show a list to jump to any question. */
  const [questionPickMode, setQuestionPickMode] = useState(false);

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

  const domainCheckGroups = useMemo(
    () => buildDomainScanCheckGroups(domainScanResult?.checks, domainScanResult?.check_groups_meta),
    [domainScanResult],
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
    if (import.meta.env.PROD && !hasRemoteApi) {
      setError(missingProductionApiMessage());
      return;
    }

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
        if (
          res.status === 404 &&
          rawText &&
          (rawText.includes("NOT_FOUND") || rawText.toLowerCase().includes("could not be found"))
        ) {
          throw new Error(
            import.meta.env.PROD && !hasRemoteApi
              ? missingProductionApiMessage()
              : `Nothing is listening at ${API_URL}. If you use Vercel for the UI, set VITE_API_BASE to your Render (or other) API URL and redeploy.`
          );
        }
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
    setQuestionPickMode(false);
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
      setDomainScanError("Enter a domain or URL (e.g. example.com).");
      return;
    }
    if (import.meta.env.PROD && !hasRemoteApi) {
      setDomainScanError(missingProductionApiMessage());
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
        if (
          res.status === 404 &&
          rawText &&
          (rawText.includes("NOT_FOUND") || rawText.toLowerCase().includes("could not be found"))
        ) {
          throw new Error(
            import.meta.env.PROD && !hasRemoteApi
              ? missingProductionApiMessage()
              : `Nothing is listening at ${DOMAIN_SCAN_URL}. Set VITE_API_BASE to your API server and redeploy.`
          );
        }
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
        setQuestionPickMode(false);
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
      <header className="mb-8 flex flex-col items-center gap-6">
        <div className="flex items-center justify-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-400/25 bg-gradient-to-br from-cyan-500/20 to-emerald-600/10">
            <span className="text-sm font-extrabold tracking-tight text-cyan-300">CR</span>
          </div>
          <h1 className="font-sans text-xl font-bold tracking-tight text-white md:text-2xl">ClearRisk</h1>
        </div>
        <nav className="flex flex-wrap justify-center gap-2">
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
              onClick={() => {
                if (id === "questionnaire") setQuestionPickMode(false);
                setActiveTab(id);
              }}
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
                d: "Structured cyber-safety questions with a review step before analysis.",
                tab: "questionnaire",
                icon: "📋",
              },
              {
                t: "Domain scan",
                d: "Run lightweight DNS / email auth / certificate / header checks using public sources.",
                tab: "domain",
                icon: "🔍",
              },
              {
                t: "Report",
                d: "Shows your posture score, risk band, and security recommendations after analysis.",
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
          {questionPickMode ? (
            <div className="mx-auto max-w-3xl">
              <div className="mb-8">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400/80">Assessment</p>
                <h2 className="mt-2 font-sans text-3xl font-bold tracking-tight text-white md:text-4xl">Choose a question</h2>
                <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-400 md:text-base">
                  Select which question to edit. After you change an answer, use{" "}
                  <span className="text-slate-300">Next</span> or <span className="text-slate-300">Back</span> to move
                  through the form, or run analysis again from the review step when you are ready.
                </p>
              </div>
              <ul className="max-h-[min(70vh,560px)] space-y-2 overflow-y-auto pr-1">
                {QUESTION_ORDER.map((qid, i) => {
                  const q = ASSESSMENT_DATA[qid];
                  const sel = answers[qid];
                  const opt = sel ? q.options.find((o) => o.id === sel) : null;
                  return (
                    <li key={qid}>
                      <button
                        type="button"
                        onClick={() => {
                          setStepIndex(i);
                          setQuestionPickMode(false);
                        }}
                        className="flex w-full gap-4 rounded-xl border border-slate-700/80 bg-slate-900/70 p-4 text-left transition-colors hover:border-cyan-500/35 hover:bg-slate-900/90"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-800 font-mono text-sm font-bold text-cyan-400/90">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{q.category}</p>
                          <p className="mt-1 text-sm font-medium leading-snug text-white">{q.text}</p>
                          <p className="mt-2 text-xs text-slate-500">
                            Current:{" "}
                            <span className="text-slate-400">{opt ? opt.label : "Not selected"}</span>
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setQuestionPickMode(false);
                    setActiveTab("report");
                  }}
                  className="rounded-xl border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-300 transition duration-200 hover:bg-slate-800/80"
                >
                  Back to report
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-8 max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400/80">Assessment</p>
                <h2 className="mt-2 font-sans text-3xl font-bold tracking-tight text-white md:text-4xl">
                  Cybersecurity posture review
                </h2>
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
                  <p className="mt-1 text-sm text-slate-400">
                    Verify selections before submitting to the analysis engine. Click any question below to go back and
                    edit that answer.
                  </p>
                  <ul className="mt-6 max-h-[min(50vh,420px)] space-y-2 overflow-y-auto pr-1">
                    {QUESTION_ORDER.map((qid, i) => {
                      const q = ASSESSMENT_DATA[qid];
                      const opt = q.options.find((o) => o.id === answers[qid]);
                      return (
                        <li key={qid}>
                          <button
                            type="button"
                            onClick={() => setStepIndex(i)}
                            className="flex w-full gap-3 rounded-xl border border-slate-700/50 bg-slate-950/40 px-4 py-3 text-left transition-colors hover:border-cyan-500/35 hover:bg-slate-900/60 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                              <span className="flex shrink-0 items-center gap-2">
                                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-800 font-mono text-xs font-bold text-cyan-400/90">
                                  {i + 1}
                                </span>
                                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{q.category}</span>
                              </span>
                              <span className="min-w-0 text-sm font-medium leading-snug text-white sm:line-clamp-2">{q.text}</span>
                            </span>
                            <span className="mt-2 shrink-0 text-sm text-slate-300 sm:mt-0 sm:max-w-[40%] sm:text-right">
                              {opt ? opt.label : "—"}
                            </span>
                          </button>
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
                  onClick={() => {
                    setActiveTab("questionnaire");
                    setQuestionPickMode(true);
                  }}
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
              Run lightweight DNS / email auth / certificate / header checks using public sources.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-500">
              Enter a <span className="text-slate-400">domain name</span> (e.g. <span className="font-mono text-slate-400">company.com</span>), optional{" "}
              <span className="text-slate-400">www</span>, or paste a <span className="text-slate-400">website URL</span>—we only use the hostname, not a
              specific page. This is not a full website audit; it reads public DNS records and a single HTTPS response.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              <span className="font-semibold text-slate-400">Email authentication</span> here means SPF and DMARC DNS records: they tell other mail servers
              which senders are allowed for your domain and what to do with messages that fail checks—reducing spoofing and improving deliverability.
            </p>
            <form className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={runDomainScan}>
              <div className="min-w-0 flex-1">
                <label htmlFor="domain-input" className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Domain, subdomain, or site URL
                </label>
                <input
                  id="domain-input"
                  type="text"
                  value={domainInput}
                  onChange={(ev) => setDomainInput(ev.target.value)}
                  placeholder="example.com or https://www.example.com"
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
                  <p
                    className={`text-3xl font-extrabold tabular-nums ${domainSurfaceScoreClass(domainScanResult.score)}`}
                  >
                    {domainScanResult.score}
                  </p>
                  <p className="text-[10px] text-slate-500">0–100 (higher is better)</p>
                </div>
              </div>

              {domainScanResult.surface_summary ? (
                <div className="rounded-xl border border-slate-600/80 bg-slate-950/50 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Summary</p>
                  <p className="mt-2 text-sm leading-relaxed text-slate-200">{domainScanResult.surface_summary}</p>
                </div>
              ) : null}

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

              <div className="space-y-6">
                {domainCheckGroups.map((g) => (
                  <div key={g.id}>
                    <h4 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{g.title}</h4>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {g.items.map((c) => (
                        <div
                          key={c.id}
                          className={`rounded-xl border px-4 py-3 text-sm ${
                            c.ok
                              ? "border-emerald-500/40 bg-emerald-950/25 text-emerald-100/95"
                              : "border-red-500/45 bg-red-950/30 text-red-100/95"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-semibold text-slate-100">{c.label || c.id}</span>
                            <span
                              className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                c.ok ? "bg-emerald-500/20 text-emerald-200" : "bg-red-500/20 text-red-200"
                              }`}
                            >
                              {c.ok ? "Good" : "Issue"}
                            </span>
                          </div>
                          <p className="mt-2 break-words text-sm opacity-90">{c.detail}</p>
                        </div>
                      ))}
                    </div>
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
