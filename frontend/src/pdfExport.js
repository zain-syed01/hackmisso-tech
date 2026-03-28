import { jsPDF } from "jspdf";
import { ASSESSMENT_DATA, ASSESSMENT_META, MAX_RAW_RISK, QUESTION_ORDER } from "./assessmentData.js";

const MARGIN = 18;
const PAGE_BOTTOM = 280;
const PAGE_W_MM = 210;

function maxTextWidth(doc) {
  return PAGE_W_MM - MARGIN * 2;
}

function lineAdvance(doc) {
  return doc.getLineHeight() / doc.internal.scaleFactor;
}

function optionLabel(qid, optId) {
  const q = ASSESSMENT_DATA[qid];
  if (!q || !optId) return "—";
  const o = q.options.find((x) => x.id === optId);
  return o ? o.label : String(optId);
}

function postureLabel(score) {
  if (score >= 80) return "Strong posture";
  if (score >= 40) return "Elevated exposure";
  return "Critical exposure";
}

function addLines(doc, lines, x, startY) {
  doc.text(lines, x, startY);
  return startY + lines.length * lineAdvance(doc);
}

function paragraph(doc, text, x, y, maxW) {
  const lines = doc.splitTextToSize(String(text), maxW);
  return addLines(doc, lines, x, y);
}

function ensureSpace(doc, y, minLines) {
  const lh = lineAdvance(doc);
  const need = minLines * lh + 4;
  if (y + need > PAGE_BOTTOM) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

/**
 * Builds a downloadable PDF of the current assessment (answers + optional last report).
 */
export function downloadAssessmentPdf({ answers, lastReport, exportedAt }) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const maxW = maxTextWidth(doc);
  let y = MARGIN;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  y = paragraph(doc, "ClearRisk — Cybersecurity Assessment", MARGIN, y, maxW);
  y += 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  y = paragraph(
    doc,
    `Generated: ${new Date(exportedAt).toLocaleString()}`,
    MARGIN,
    y,
    maxW
  );
  y += 6;

  if (lastReport && typeof lastReport.score === "number") {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    y = ensureSpace(doc, y, 3);
    y = paragraph(doc, "Risk summary", MARGIN, y, maxW);
    y += 3;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const s = lastReport.score;
    const rt = lastReport.riskTotal;
    const band = lastReport.riskBand;
    const bandMsg = lastReport.riskBandMessage;
    let line = `Posture score: ${s}% — ${postureLabel(s)}. ${ASSESSMENT_META.title}.`;
    if (typeof rt === "number" && band) {
      line += ` Raw risk index: ${Math.round(rt)} / ${MAX_RAW_RISK} (${band}).`;
      if (bandMsg) line += ` ${bandMsg}`;
    }
    y = paragraph(doc, line, MARGIN, y, maxW);
    y += 2;
    if (lastReport.savedAt) {
      y = paragraph(doc, `Report saved: ${new Date(lastReport.savedAt).toLocaleString()}`, MARGIN, y, maxW);
      y += 2;
    }
    if (lastReport.recommendationSource) {
      y = paragraph(
        doc,
        `Recommendations source: ${lastReport.recommendationSource}`,
        MARGIN,
        y,
        maxW
      );
      y += 4;
    } else {
      y += 4;
    }

    const recs = Array.isArray(lastReport.recommendations) ? lastReport.recommendations : [];
    if (recs.length > 0) {
      doc.setFont("helvetica", "bold");
      y = ensureSpace(doc, y, 2);
      y = paragraph(doc, "Recommendations", MARGIN, y, maxW);
      y += 3;
      doc.setFont("helvetica", "normal");

      recs.forEach((rec, i) => {
        const block = `${i + 1}. ${String(rec)}`;
        const lines = doc.splitTextToSize(block, maxW);
        y = ensureSpace(doc, y, Math.max(lines.length, 2));
        y = addLines(doc, lines, MARGIN, y);
        y += 2;
      });
    }
  } else {
    y = ensureSpace(doc, y, 3);
    y = paragraph(
      doc,
      "No analysis report on file yet. Run analysis from the questionnaire to include scores and recommendations in this PDF.",
      MARGIN,
      y,
      maxW
    );
    y += 6;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  y = ensureSpace(doc, y, 2);
  y = paragraph(doc, "Questionnaire responses", MARGIN, y, maxW);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  QUESTION_ORDER.forEach((qid, idx) => {
    const meta = ASSESSMENT_DATA[qid];
    const ans = optionLabel(qid, answers[qid]);
    const header = `${idx + 1}. [${meta.category}]`;
    const body = `${meta.text}\nAnswer: ${ans}`;
    const lines = doc.splitTextToSize(`${header}\n${body}`, maxW);
    y = ensureSpace(doc, y, Math.max(lines.length, 3));
    y = addLines(doc, lines, MARGIN, y);
    y += 5;
  });

  const stamp = new Date(exportedAt).toISOString().slice(0, 10);
  doc.save(`clearrisk-assessment-${stamp}.pdf`);
}
