import { motion } from "framer-motion";

function domainSurfaceScoreClass(score) {
  const n = Number(score);
  if (Number.isNaN(n)) return "text-cyan-300";
  if (n >= 80) return "text-emerald-300";
  if (n >= 55) return "text-amber-300";
  return "text-red-300";
}

export default function DomainScanTab({
  domainInput,
  onDomainInputChange,
  domainScanLoading,
  onSubmitDomainScan,
  domainScanError,
  domainScanResult,
  domainCheckGroups,
}) {
  return (
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
        <form className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={onSubmitDomainScan}>
          <div className="min-w-0 flex-1">
            <label htmlFor="domain-input" className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Domain, subdomain, or site URL
            </label>
            <input
              id="domain-input"
              type="text"
              value={domainInput}
              onChange={(ev) => onDomainInputChange(ev.target.value)}
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
  );
}
