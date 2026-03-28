/**
 * Parse built-in (fallback) recommendation strings into readable sections.
 * Gemini prose is returned as a single body.
 */
export function parseRecommendationText(text, source) {
  if (source !== "fallback") {
    return { mode: "prose", body: text };
  }

  const marker = "Exposure includes ";
  const idx = text.indexOf(marker);
  if (idx === -1) {
    return { mode: "prose", body: text };
  }

  const head = text.slice(0, idx).trim();
  const tail = text.slice(idx + marker.length).trim();

  const scoreMatch = head.match(/\(score\s*(\d+)\s*\/\s*100\)/i);
  const score = scoreMatch ? scoreMatch[1] : null;

  let question = head.replace(/^Strengthen:\s*/i, "").trim();
  question = question.replace(/\s*\(\s*score\s*\d+\s*\/\s*100\s*\)\s*\.?\s*$/i, "").trim();

  const actionStarters = [
    "Assign a named owner",
    "Document the desired",
    "Review progress with",
    "Tie open gaps",
    "Map each open item",
    "Schedule a follow-up assessment",
  ];

  let actionStart = -1;
  let actionPrefix = "";
  for (const prefix of actionStarters) {
    const at = tail.indexOf(prefix);
    if (at !== -1 && (actionStart === -1 || at < actionStart)) {
      actionStart = at;
      actionPrefix = prefix;
    }
  }

  if (actionStart === -1) {
    return {
      mode: "structured",
      question,
      score,
      risk: tail,
      action: null,
    };
  }

  const risk = tail.slice(0, actionStart).trim().replace(/\.\s*$/, "");
  const action = tail.slice(actionStart).trim();

  return {
    mode: "structured",
    question,
    score,
    risk,
    action,
  };
}
