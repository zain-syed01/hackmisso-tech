import raw from "../../assessment_questions.json";

/** @typedef {{ id: string, label: string, score: number }} Opt */

function buildAssessmentData() {
  /** @type {Record<string, { text: string, category: string, options: Opt[] }>} */
  const out = {};
  for (const q of raw.questions) {
    out[q.id] = {
      category: q.category,
      text: q.text,
      options: q.options.map((o) => ({
        id: o.id,
        label: o.text,
        score: o.score,
      })),
    };
  }
  return out;
}

export const ASSESSMENT_META = raw.meta;
export const ASSESSMENT_DATA = buildAssessmentData();
export const QUESTION_ORDER = raw.questions.map((q) => q.id);

export const MAX_RAW_RISK = QUESTION_ORDER.reduce((sum, qid) => {
  const opts = ASSESSMENT_DATA[qid].options;
  return sum + Math.max(...opts.map((o) => o.score));
}, 0);
