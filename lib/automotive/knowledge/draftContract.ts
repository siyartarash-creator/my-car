// Track B (parallel worker) -- deterministic validation for structured case
// drafts. Pure functions, no DB/AI access. This is the hard-reject boundary;
// qualityChecks.ts holds softer warnings. See docs/automotive/knowledge/README.md.
import {
  ALLOWED_CONFIDENCE,
  ALLOWED_PROVENANCE,
  ALLOWED_REVIEW_STATUS,
  ALLOWED_RISK,
  type StructuredCaseDraft,
} from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates the structural invariants a StructuredCaseDraft must satisfy
 * before it can move forward in the review pipeline. Never mutates the
 * draft and never fills in a value on its behalf -- unknown stays unknown.
 */
export function validateCaseDraft(draft: StructuredCaseDraft): ValidationResult {
  const errors: string[] = [];

  if (!ALLOWED_PROVENANCE.includes(draft.provenance)) {
    errors.push(`invalid provenance: ${String(draft.provenance)}`);
  }
  if (!ALLOWED_CONFIDENCE.includes(draft.confidence)) {
    errors.push(`invalid confidence: ${String(draft.confidence)}`);
  }
  if (!ALLOWED_RISK.includes(draft.riskLevel)) {
    errors.push(`invalid riskLevel: ${String(draft.riskLevel)}`);
  }
  if (!ALLOWED_REVIEW_STATUS.includes(draft.reviewStatus)) {
    errors.push(`invalid reviewStatus: ${String(draft.reviewStatus)}`);
  }

  if (!draft.reportedSymptoms || draft.reportedSymptoms.trim().length === 0) {
    errors.push("reportedSymptoms is required and cannot be empty");
  }

  // Fixture/real boundary: literal synthetic fixture data (origin
  // "fixture") must always be flagged isFixture. Separately, synthetic data
  // can never claim to be Mehdi's literal, unmodified words (origin
  // "mechanic_authored") -- that specific combination is what "fixture
  // masquerading as real mechanic knowledge" would look like. A fixture
  // exercising the AI-structuring path (origin "ai_structured") is fine --
  // it's still blocked from publication below.
  if (draft.origin === "fixture" && !draft.isFixture) {
    errors.push('origin "fixture" requires isFixture: true');
  }
  if (draft.isFixture && draft.origin === "mechanic_authored") {
    errors.push('isFixture drafts cannot have origin "mechanic_authored" (would masquerade as real mechanic authorship)');
  }

  // AI transformation must be distinguishable from literal mechanic words.
  if (draft.origin === "mechanic_authored" && draft.aiTransformed) {
    errors.push('origin "mechanic_authored" cannot have aiTransformed: true (contradicts unmodified authorship)');
  }
  if (draft.origin === "ai_structured" && !draft.aiTransformed) {
    errors.push('origin "ai_structured" requires aiTransformed: true');
  }

  // Confirmed cause cannot be implied/invented: it must be one of the
  // candidate causes actually considered, and it must be backed by an
  // actual diagnostic test or measured result -- never bare assertion.
  if (draft.confirmedCause.known) {
    if (!draft.candidateCauses.includes(draft.confirmedCause.value)) {
      errors.push("confirmedCause must be one of the listed candidateCauses");
    }
    if (!draft.diagnosticTestsPerformed.known && !draft.measuredResults.known) {
      errors.push("confirmedCause requires diagnosticTestsPerformed or measuredResults as support");
    }
  }

  // Publication/review boundary: mirrors the DB's
  // published_requires_human_review constraint, plus the fixture
  // exclusion -- synthetic data can never enter the real knowledge path.
  if (draft.reviewStatus === "published") {
    if (!draft.reviewedByProfileId.known || !draft.reviewedAt.known) {
      errors.push("published drafts require reviewedByProfileId and reviewedAt");
    }
    if (draft.isFixture) {
      errors.push("fixture drafts cannot reach reviewStatus: published");
    }
  }

  return { valid: errors.length === 0, errors };
}
