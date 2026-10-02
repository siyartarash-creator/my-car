// Tests for the explicit review workflow: approval boundary, fixture
// isolation, provenance protection, edit-resets-review, and the
// approved-output compatibility shape. No database, no network.
import assert from "node:assert/strict";
import { load } from "../../helpers/load-typescript.mjs";

const knowledgeTypes = load("lib/automotive/knowledge/types.ts", {});
const draftContract = load("lib/automotive/knowledge/draftContract.ts", { "./types": knowledgeTypes });
const qualityChecks = load("lib/automotive/knowledge/qualityChecks.ts", { "./types": knowledgeTypes });
const reviewWorkflow = load("lib/automotive/knowledge/reviewWorkflow.ts", {
  "./types": knowledgeTypes,
  "./draftContract": draftContract,
  "./qualityChecks": qualityChecks,
});
const draftBuilder = load("lib/automotive/knowledge/draftBuilder.ts", { "./types": knowledgeTypes });

const { knownField } = knowledgeTypes;
const {
  toReviewable,
  submitForReview,
  editDraft,
  approveDraft,
  rejectDraft,
  toReadyForIntakeResult,
  ReviewWorkflowError,
} = reviewWorkflow;
const { createEmptyDraft } = draftBuilder;

let passed = 0;
function check(cond, label) {
  assert.ok(cond, label);
  passed++;
}

function completeDraft(overrides = {}) {
  const d = createEmptyDraft({ id: "draft-1" });
  return {
    ...d,
    reportedSymptoms: "cranked normally but would not start",
    mechanicObservations: knownField("scanner showed zero RPM while cranking"),
    diagnosticTestsPerformed: knownField("checked crank sensor wiring"),
    candidateCauses: ["crank position sensor fault"],
    confirmedCause: knownField("crank position sensor fault"),
    repairActionPerformed: knownField("replaced crank sensor"),
    outcome: knownField("started and idled normally"),
    confidence: "high",
    riskLevel: "routine_safe",
    ...overrides,
  };
}

// --- unknown preservation: a blank draft has every optional field unknown --
{
  const d = createEmptyDraft({ id: "draft-blank" });
  check(d.mechanicObservations.known === false, "mechanicObservations starts unknown");
  check(d.confirmedCause.known === false, "confirmedCause starts unknown");
  check(d.repairActionPerformed.known === false, "repairActionPerformed starts unknown");
  check(d.vehicle.make.known === false, "vehicle.make starts unknown");
}

// --- approval requirement: cannot reach intake without explicit approval --
{
  const reviewable = toReviewable(completeDraft());
  assert.throws(() => toReadyForIntakeResult(reviewable), ReviewWorkflowError, "draft state is rejected for intake");
  passed++;

  const needsReview = submitForReview(reviewable);
  assert.throws(() => toReadyForIntakeResult(needsReview), ReviewWorkflowError, "needs_review state is still rejected for intake");
  passed++;
}

// --- explicit approval produces a ready-for-intake, Core-compatible shape --
{
  const reviewable = submitForReview(toReviewable(completeDraft()));
  const { reviewable: approved, warnings } = approveDraft(reviewable, {
    reviewerProfileId: "a0000000-0000-0000-0000-000000000001",
    approvedAt: "2026-01-01T00:00:00Z",
  });
  check(approved.state === "approved", "state becomes approved");
  const output = toReadyForIntakeResult(approved);
  check(output.reviewStatus === "reviewed", "approved output has reviewStatus: reviewed");
  check(output.reviewedByProfileId.known === true && output.reviewedByProfileId.value === "a0000000-0000-0000-0000-000000000001", "reviewer identity recorded explicitly");
  check(typeof output.reportedSymptoms === "string" && output.candidateCauses.length > 0, "output retains the StructuredCaseDraft shape the Core adapter expects");
  check(Array.isArray(warnings), "quality warnings returned alongside approval");
}

// --- fixture isolation: a fixture can never be approved -------------------
{
  const fixtureDraft = { ...completeDraft(), isFixture: true, origin: "fixture" };
  const reviewable = toReviewable(fixtureDraft);
  assert.throws(
    () => approveDraft(reviewable, { reviewerProfileId: "a0000000-0000-0000-0000-000000000001", approvedAt: "now" }),
    ReviewWorkflowError,
    "fixture draft rejected at the approval boundary",
  );
  passed++;
}

// --- invalid draft rejection: approval re-runs structural validation ------
{
  const invalidDraft = { ...completeDraft(), reportedSymptoms: "" };
  const reviewable = toReviewable(invalidDraft);
  assert.throws(
    () => approveDraft(reviewable, { reviewerProfileId: "a0000000-0000-0000-0000-000000000001", approvedAt: "now" }),
    ReviewWorkflowError,
    "structurally invalid draft rejected at approval, not just at the DB boundary",
  );
  passed++;
}

// --- mechanic-authored provenance protection: approval never relabels origin --
{
  const aiDraft = { ...completeDraft(), origin: "ai_structured", aiTransformed: true };
  const reviewable = submitForReview(toReviewable(aiDraft));
  const { reviewable: approved } = approveDraft(reviewable, {
    reviewerProfileId: "a0000000-0000-0000-0000-000000000001",
    approvedAt: "2026-01-01T00:00:00Z",
  });
  check(approved.draft.origin === "ai_structured", "approval never silently relabels ai_structured origin as mechanic_authored");
  check(approved.draft.aiTransformed === true, "aiTransformed flag is preserved through approval");
}

// --- editing resets review state and clears prior review metadata --------
{
  const reviewable = submitForReview(toReviewable(completeDraft()));
  const { reviewable: approved } = approveDraft(reviewable, {
    reviewerProfileId: "a0000000-0000-0000-0000-000000000001",
    approvedAt: "2026-01-01T00:00:00Z",
  });
  const edited = editDraft(approved, { mechanicNotes: knownField("corrected detail") });
  check(edited.state === "draft", "editing an approved draft resets state to draft");
  check(edited.draft.reviewedByProfileId.known === false, "editing clears prior reviewer identity");
  check(edited.draft.reviewedAt.known === false, "editing clears prior review timestamp");
  assert.throws(() => toReadyForIntakeResult(edited), ReviewWorkflowError, "edited draft is no longer ready for intake until re-approved");
  passed++;
}

// --- reject/discard: a rejected draft is never usable for intake ----------
{
  const reviewable = submitForReview(toReviewable(completeDraft()));
  const rejected = rejectDraft(reviewable, "cause not actually confirmed, needs more detail");
  check(rejected.state === "rejected", "state becomes rejected");
  check(rejected.rejectionReason === "cause not actually confirmed, needs more detail", "rejection reason preserved verbatim");
  assert.throws(() => toReadyForIntakeResult(rejected), ReviewWorkflowError, "rejected draft is never ready for intake");
  passed++;
  assert.throws(
    () => approveDraft(rejected, { reviewerProfileId: "a0000000-0000-0000-0000-000000000001", approvedAt: "now" }),
    ReviewWorkflowError,
    "a rejected draft cannot be approved directly -- must be edited first",
  );
  passed++;
}

console.log(`automotive/knowledge/review-workflow.test.mjs: ${passed} checks passed`);
