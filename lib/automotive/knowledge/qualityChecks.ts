// Track B (parallel worker) -- soft quality checks for structured case
// drafts. These are warnings, not hard rejects (see draftContract.ts for the
// reject boundary) -- a reviewer makes the final call, this just surfaces
// things worth a second look before publication.
import type { StructuredCaseDraft } from "./types";

export interface QualityWarning {
  code: string;
  message: string;
}

const SAFETY_KEYWORDS = [
  "brake",
  "airbag",
  "srs",
  "fuel",
  "high-current",
  "high voltage",
  "structural",
  "suspension",
];

function mentionsSafetyKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return SAFETY_KEYWORDS.some((k) => lower.includes(k));
}

/**
 * Surfaces non-fatal quality concerns on an already-structurally-valid
 * draft. Callers should run validateCaseDraft first -- this does not repeat
 * those checks.
 */
export function checkDraftQuality(draft: StructuredCaseDraft): QualityWarning[] {
  const warnings: QualityWarning[] = [];

  if (draft.repairActionPerformed.known && !draft.outcome.known) {
    warnings.push({
      code: "repair_without_outcome",
      message: "A repair/action was recorded but no outcome was confirmed -- was the complaint actually resolved?",
    });
  }

  const safetyRelevantText = [
    draft.reportedSymptoms,
    draft.mechanicObservations.known ? draft.mechanicObservations.value : "",
    draft.repairActionPerformed.known ? draft.repairActionPerformed.value : "",
  ].join(" ");
  if (
    mentionsSafetyKeyword(safetyRelevantText) &&
    draft.riskLevel !== "requires_caution" &&
    draft.riskLevel !== "safety_critical"
  ) {
    warnings.push({
      code: "safety_keyword_risk_mismatch",
      message: `Case mentions a safety-sensitive system but riskLevel is "${draft.riskLevel}" -- confirm this classification.`,
    });
  }

  if (draft.candidateCauses.length === 0 && !draft.confirmedCause.known) {
    warnings.push({
      code: "no_candidate_causes",
      message: "No candidate causes were recorded -- confirm this case has enough diagnostic content to be useful.",
    });
  }

  if (draft.origin === "ai_structured" && draft.provenance === "mechanic_authored" && !draft.sourceCaseId) {
    warnings.push({
      code: "ai_structured_missing_source_link",
      message: "AI-structured draft claims mechanic_authored provenance but has no sourceCaseId linking back to the original intake.",
    });
  }

  return warnings;
}
