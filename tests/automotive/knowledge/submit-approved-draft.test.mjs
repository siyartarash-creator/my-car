// Tests for the full approved-draft -> Core validation -> persistence
// pipeline, using a fake Supabase client (no network, no real DB -- RLS/
// schema behavior itself is covered by schema-security.mjs against PGlite).
// This test only verifies the chain's own logic: it calls Core's
// parseCaseIntakeDraft unchanged, and it never attempts an insert unless the
// draft is actually in "approved" state.
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
const caseIntake = load("lib/automotive/caseIntake.ts", { "./types": {} });
const toCaseIntake = load("lib/automotive/knowledge/toCaseIntake.ts", {
  "../caseIntake": caseIntake,
  "./types": knowledgeTypes,
});
const persistCaseIntake = load("lib/automotive/knowledge/persistCaseIntake.ts", {
  "../caseIntake": caseIntake,
  "server-only": {},
});
const submitApprovedDraft = load("lib/automotive/knowledge/submitApprovedDraft.ts", {
  "../caseIntake": caseIntake,
  "./persistCaseIntake": persistCaseIntake,
  "./reviewWorkflow": reviewWorkflow,
  "./toCaseIntake": toCaseIntake,
  "server-only": {},
});

const { knownField } = knowledgeTypes;
const { toReviewable, submitForReview, approveDraft } = reviewWorkflow;
const { createEmptyDraft } = draftBuilder;
const { submitApprovedDraftToIntake } = submitApprovedDraft;

let passed = 0;
function check(cond, label) {
  assert.ok(cond, label);
  passed++;
}

function completeDraft() {
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
  };
}

function fakeClient(insertedRows) {
  return {
    from(table) {
      return {
        insert(row) {
          return {
            select() {
              return {
                async single() {
                  insertedRows.push({ table, row });
                  return { data: { id: 42 }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

// --- approved draft flows through to a persisted row ----------------------
{
  const reviewable = submitForReview(toReviewable(completeDraft()));
  const { reviewable: approved } = approveDraft(reviewable, {
    reviewerProfileId: "a0000000-0000-0000-0000-000000000001",
    approvedAt: "2026-01-01T00:00:00Z",
  });
  const inserted = [];
  const client = fakeClient(inserted);
  const result = await submitApprovedDraftToIntake(client, approved, "a0000000-0000-0000-0000-000000000001");
  check(result.id === "42", "returns the inserted row id");
  check(inserted.length === 1 && inserted[0].table === "automotive_case_intake", "inserted into automotive_case_intake, nothing else");
  check(inserted[0].row.resolution.includes("replaced crank sensor"), "Core's parseCaseIntakeDraft output reaches the insert call unmodified");
}

// --- not approved: no insert is ever attempted -----------------------------
{
  const reviewable = toReviewable(completeDraft()); // still "draft"
  const inserted = [];
  const client = fakeClient(inserted);
  await assert.rejects(
    () => submitApprovedDraftToIntake(client, reviewable, "a0000000-0000-0000-0000-000000000001"),
    "unapproved draft is rejected before any DB call",
  );
  passed++;
  check(inserted.length === 0, "no insert attempted for an unapproved draft");
}

console.log(`automotive/knowledge/submit-approved-draft.test.mjs: ${passed} checks passed`);
