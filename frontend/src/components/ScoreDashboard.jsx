import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { parseRecommendationText } from "../recommendationUtils.js";
import { normalizeRecommendationList, sortRecommendationsBySeverity } from "../severityUtils.js";

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

const easeOut = [0.16, 1, 0.3, 1];

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

export default function ScoreDashboard({ score, recommendations, recommendationSource = null, aiProviderError = null }) {
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
