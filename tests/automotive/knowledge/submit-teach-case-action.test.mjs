// Regression test for a real staging bug: submitApprovedDraftToIntake's
// lib-level contract is to throw (see submit-approved-draft.test.mjs), but a
// raw throw across the "use server" boundary in app/automotive/teach/actions.ts
// is exactly what Next.js redacts into the opaque "Minified React error #441"
// in a production build -- the user saw a crash instead of the real,
// actionable Persian message. submitTeachCase must catch the known,
// user-correctable error types and return { error } instead of throwing, so
// the UI can show the real reason submission didn't persist.
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

const ADMIN_ID = "a0000000-0000-0000-0000-000000000001";
const fakeAuthServer = {
  requireRole: async () => ({ client: fakeClient([]), user: { id: ADMIN_ID } }),
};

function fakeClient(insertedRows) {
  return {
    from() {
      return {
        insert(row) {
          return {
            select() {
              return {
                async single() {
                  insertedRows.push(row);
                  return { data: { id: 99 }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

const actions = load("app/automotive/teach/actions.ts", {
  "@/lib/auth-server": fakeAuthServer,
  "@/lib/automotive/caseIntake": caseIntake,
  "@/lib/automotive/knowledge/reviewWorkflow": reviewWorkflow,
  "@/lib/automotive/knowledge/submitApprovedDraft": submitApprovedDraft,
  "@/lib/automotive/knowledge/toCaseIntake": toCaseIntake,
});

const { knownField } = knowledgeTypes;
const { toReviewable, submitForReview, approveDraft } = reviewWorkflow;
const { createEmptyDraft } = draftBuilder;
const { submitTeachCase } = actions;

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
    diagnosticTestsPerformed: knownField("checked crank sensor wiring"),
    candidateCauses: ["crank position sensor fault"],
    confirmedCause: knownField("crank position sensor fault"),
    confidence: "high",
    riskLevel: "routine_safe",
    // repairActionPerformed/outcome intentionally left unknown -- this is
    // exactly the real staging repro: approved for review, but not yet
    // ready for intake.
  };
}

// --- the real repro: approved but missing repair/outcome never throws raw ---
{
  const reviewable = submitForReview(toReviewable(completeDraft()));
  const { reviewable: approved } = approveDraft(reviewable, {
    reviewerProfileId: ADMIN_ID,
    approvedAt: "2026-01-01T00:00:00Z",
  });
  const result = await submitTeachCase(approved);
  check("error" in result, "returns a handled error instead of throwing across the action boundary");
  check(
    typeof result.error === "string" && result.error.length > 0,
    "error message is the real, actionable reason (not an opaque digest)",
  );
}

// --- happy path still returns the real id ------------------------------------
{
  const complete = completeDraft();
  const ready = { ...complete, repairActionPerformed: knownField("replaced crank sensor"), outcome: knownField("started and idled normally") };
  const reviewable = submitForReview(toReviewable(ready));
  const { reviewable: approved } = approveDraft(reviewable, {
    reviewerProfileId: ADMIN_ID,
    approvedAt: "2026-01-01T00:00:00Z",
  });
  const result = await submitTeachCase(approved);
  check(!("error" in result), "a ready, approved draft persists without error");
  check(result.id === "99", "returns the real inserted row id");
}

console.log(`automotive/knowledge/submit-teach-case-action.test.mjs: ${passed} checks passed`);
