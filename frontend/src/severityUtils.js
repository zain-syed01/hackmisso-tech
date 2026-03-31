/** Shared severity ordering for recommendations (UI + PDF). */

export const REC_SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

export function normalizeRecommendationList(raw) {
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

export function sortRecommendationsBySeverity(items) {
  return [...items].sort((a, b) => REC_SEVERITY_ORDER[a.severity] - REC_SEVERITY_ORDER[b.severity]);
}
