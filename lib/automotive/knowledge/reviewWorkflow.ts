// Mobile Alpha Worker B -- explicit review workflow around a
// StructuredCaseDraft. This is the approval boundary: nothing here ever
// silently marks AI-structured content as mechanic-authored truth, nothing
// here ever lets a fixture become real, and nothing becomes "approved"
// without an explicit human action naming who approved it.
import { validateCaseDraft, type ValidationResult } from "./draftContract";
import { checkDraftQuality, type QualityWarning } from "./qualityChecks";
import { knownField, unknownField, type StructuredCaseDraft } from "./types";

export type ReviewState = "draft" | "needs_review" | "approved" | "rejected";

export interface ReviewableCaseDraft {
  draft: StructuredCaseDraft;
  state: ReviewState;
  /** Set only by rejectDraft -- never fabricated, always the human's own words. */
  rejectionReason?: string | null;
}

export class ReviewWorkflowError extends Error {}

/** Wraps a freshly built/proposed draft in "draft" state -- always the starting point. */
export function toReviewable(draft: StructuredCaseDraft): ReviewableCaseDraft {
  return { draft, state: "draft" };
}

/**
 * Marks a draft ready for Mehdi/an admin to look at. Does not change any
 * draft content or provenance field -- purely a workflow-state transition.
 */
export function submitForReview(reviewable: ReviewableCaseDraft): ReviewableCaseDraft {
  if (reviewable.state === "approved") {
    throw new ReviewWorkflowError("an approved draft cannot be resubmitted without an edit first");
  }
  return { draft: reviewable.draft, state: "needs_review" };
}

/**
 * Edits a draft's content. Always resets the workflow state back to
 * "draft" and clears any prior review metadata -- a previously approved
 * draft whose content changed is no longer the thing that was approved, so
 * it must be re-reviewed. This is the structural guard against "approve
 * once, edit forever" drift.
 */
export function editDraft(
  reviewable: ReviewableCaseDraft,
  updates: Partial<StructuredCaseDraft>,
): ReviewableCaseDraft {
  const draft: StructuredCaseDraft = {
    ...reviewable.draft,
    ...updates,
    reviewStatus: "draft",
    reviewedByProfileId: unknownField(),
    reviewedAt: unknownField(),
  };
  return { draft, state: "draft", rejectionReason: null };
}

export interface ApprovalContext {
  reviewerProfileId: string;
  approvedAt: string;
}

export interface ApprovalResult {
  reviewable: ReviewableCaseDraft;
  warnings: QualityWarning[];
}

/**
 * The explicit approval boundary. Throws (never silently falls back) when:
 * - the draft is a fixture (fixtures can never become real Mehdi knowledge)
 * - the draft fails validateCaseDraft's structural invariants
 *
 * On success, sets reviewStatus: "reviewed" and the reviewer identity --
 * never reviewStatus: "published" (that remains a separate Core/admin
 * action once this draft is converted to case intake) -- and NEVER touches
 * `origin`/`provenance`/`aiTransformed`: approval reviews and signs off on
 * content, it does not relabel who/what produced it.
 */
export function approveDraft(reviewable: ReviewableCaseDraft, context: ApprovalContext): ApprovalResult {
  if (reviewable.draft.isFixture) {
    throw new ReviewWorkflowError("fixture drafts can never be approved into real Mehdi knowledge");
  }
  if (reviewable.state === "rejected") {
    throw new ReviewWorkflowError("a rejected draft must be edited and resubmitted before it can be approved");
  }

  const candidate: StructuredCaseDraft = {
    ...reviewable.draft,
    reviewStatus: "reviewed",
    reviewedByProfileId: knownField(context.reviewerProfileId),
    reviewedAt: knownField(context.approvedAt),
  };

  const validation: ValidationResult = validateCaseDraft(candidate);
  if (!validation.valid) {
    throw new ReviewWorkflowError(`draft failed validation and cannot be approved: ${validation.errors.join("; ")}`);
  }

  return {
    reviewable: { draft: candidate, state: "approved", rejectionReason: null },
    warnings: checkDraftQuality(candidate),
  };
}

/**
 * Explicitly discards a draft. A rejected draft is never usable for intake
 * -- see toReadyForIntakeResult -- and must be edited (which resets state
 * to "draft") before it can be resubmitted.
 */
export function rejectDraft(reviewable: ReviewableCaseDraft, reason: string): ReviewableCaseDraft {
  return { draft: reviewable.draft, state: "rejected", rejectionReason: reason };
}

/**
 * The only way to obtain the "ready-for-intake" result: the approved
 * StructuredCaseDraft itself, compatible with the existing
 * StructuredCaseDraft -> Core CaseIntake adapter concept. Throws for any
 * state other than "approved" -- there is no partial-credit path.
 */
export function toReadyForIntakeResult(reviewable: ReviewableCaseDraft): StructuredCaseDraft {
  if (reviewable.state !== "approved") {
    throw new ReviewWorkflowError(`draft is not approved (state: ${reviewable.state}) -- not ready for intake`);
  }
  return reviewable.draft;
}
