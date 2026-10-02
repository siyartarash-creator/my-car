// Pure-logic tests for the structured case draft contract: validation,
// quality checks, and the natural-narration provider boundary. No database,
// no network, no AI service -- see ../schema-security.mjs for DB-level
// coverage of the existing Milestone 1 surface.
import assert from "node:assert/strict";
import { load } from "../../helpers/load-typescript.mjs";

const knowledgeTypes = load("lib/automotive/knowledge/types.ts", {});
const draftContract = load("lib/automotive/knowledge/draftContract.ts", {
  "./types": knowledgeTypes,
});
const qualityChecks = load("lib/automotive/knowledge/qualityChecks.ts", {
  "./types": knowledgeTypes,
});
const narrationProvider = load("lib/automotive/knowledge/narrationProvider.ts", {
  "./types": knowledgeTypes,
});
const mockProvider = load("tests/automotive/knowledge/testSupport/mockCaseDraftProvider.ts", {
  "../../../../lib/automotive/knowledge/types": knowledgeTypes,
  "../../../../lib/automotive/knowledge/narrationProvider": narrationProvider,
});

const { unknownField, knownField } = knowledgeTypes;
const { validateCaseDraft } = draftContract;
const { checkDraftQuality } = qualityChecks;
const { TEST_ONLY_mockCaseDraftProvider } = mockProvider;

let passed = 0;
function check(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  passed++;
}
function ok(condition, label) {
  assert.ok(condition, label);
  passed++;
}

function baseDraft(overrides = {}) {
  return {
    id: "draft-1",
    sourceCaseId: null,
    vehicle: {
      make: unknownField(),
      model: unknownField(),
      yearFrom: unknownField(),
      yearTo: unknownField(),
      engineVariant: unknownField(),
    },
    reportedSymptoms: "engine cranks but will not start",
    mechanicObservations: unknownField(),
    diagnosticTestsPerformed: unknownField(),
    measuredResults: unknownField(),
    candidateCauses: [],
    confirmedCause: unknownField(),
    repairActionPerformed: unknownField(),
    outcome: unknownField(),
    mechanicNotes: unknownField(),
    origin: "mechanic_authored",
    provenance: "mechanic_authored",
    confidence: "medium",
    riskLevel: "routine_safe",
    reviewStatus: "draft",
    isFixture: false,
    aiTransformed: false,
    reviewedByProfileId: unknownField(),
    reviewedAt: unknownField(),
    ...overrides,
  };
}

// --- valid draft accepted -----------------------------------------------
{
  const result = validateCaseDraft(baseDraft());
  check(result, { valid: true, errors: [] }, "minimal valid draft is accepted");
}

// --- missing/fabricated mechanic facts not silently introduced ----------
{
  const draft = baseDraft({ reportedSymptoms: "" });
  const result = validateCaseDraft(draft);
  ok(!result.valid, "empty reportedSymptoms rejected");
  ok(result.errors.some((e) => e.includes("reportedSymptoms")), "error names reportedSymptoms");
}

// --- invalid provenance rejected ----------------------------------------
{
  const draft = baseDraft({ provenance: "made_up_source" });
  const result = validateCaseDraft(draft);
  ok(!result.valid, "invalid provenance rejected");
  ok(result.errors.some((e) => e.includes("provenance")), "error names provenance");
}

// --- fixture isolation ---------------------------------------------------
{
  const asFixtureWrongOrigin = baseDraft({ isFixture: true, origin: "mechanic_authored" });
  const result = validateCaseDraft(asFixtureWrongOrigin);
  ok(!result.valid, "isFixture true with mechanic_authored origin rejected");

  const originFixtureNotMarked = baseDraft({ origin: "fixture", isFixture: false });
  const result2 = validateCaseDraft(originFixtureNotMarked);
  ok(!result2.valid, "origin fixture without isFixture true rejected");

  const consistent = baseDraft({ origin: "fixture", isFixture: true, provenance: "ai_inferred" });
  const result3 = validateCaseDraft(consistent);
  ok(result3.valid, "consistent fixture origin/isFixture accepted");
}

// --- review-required behavior (publication boundary) --------------------
{
  const publishedNoReview = baseDraft({ reviewStatus: "published" });
  const result = validateCaseDraft(publishedNoReview);
  ok(!result.valid, "published without reviewedBy/reviewedAt rejected");

  const publishedWithReview = baseDraft({
    reviewStatus: "published",
    reviewedByProfileId: knownField("admin-1"),
    reviewedAt: knownField("2026-01-01T00:00:00Z"),
  });
  const result2 = validateCaseDraft(publishedWithReview);
  ok(result2.valid, "published with full review metadata accepted");

  const publishedFixture = baseDraft({
    reviewStatus: "published",
    isFixture: true,
    origin: "fixture",
    reviewedByProfileId: knownField("admin-1"),
    reviewedAt: knownField("2026-01-01T00:00:00Z"),
  });
  const result3 = validateCaseDraft(publishedFixture);
  ok(!result3.valid, "fixture drafts cannot be published even with review metadata");
}

// --- confirmed-cause rules ------------------------------------------------
{
  const unsupportedConfirmed = baseDraft({
    candidateCauses: ["failed ignition coil"],
    confirmedCause: knownField("failed ignition coil"),
  });
  const result = validateCaseDraft(unsupportedConfirmed);
  ok(!result.valid, "confirmedCause without diagnostic support rejected");

  const notAmongCandidates = baseDraft({
    candidateCauses: ["failed ignition coil"],
    confirmedCause: knownField("something else entirely"),
    diagnosticTestsPerformed: knownField("spark test"),
  });
  const result2 = validateCaseDraft(notAmongCandidates);
  ok(!result2.valid, "confirmedCause not among candidateCauses rejected");

  const validConfirmed = baseDraft({
    candidateCauses: ["failed ignition coil"],
    confirmedCause: knownField("failed ignition coil"),
    diagnosticTestsPerformed: knownField("spark test at the plug"),
  });
  const result3 = validateCaseDraft(validConfirmed);
  ok(result3.valid, "confirmedCause with support and candidate membership accepted");
}

// --- safety/risk validation (structural) ---------------------------------
{
  const draft = baseDraft({ riskLevel: "extremely_dangerous" });
  const result = validateCaseDraft(draft);
  ok(!result.valid, "invalid riskLevel rejected");
}

// --- quality checks: repair without outcome -------------------------------
{
  const draft = baseDraft({ repairActionPerformed: knownField("replaced ignition coil") });
  const warnings = checkDraftQuality(draft);
  ok(warnings.some((w) => w.code === "repair_without_outcome"), "repair without outcome flagged");
}

// --- quality checks: safety keyword vs risk mismatch ----------------------
{
  const draft = baseDraft({
    reportedSymptoms: "brake pedal goes to the floor",
    riskLevel: "informational",
  });
  const warnings = checkDraftQuality(draft);
  ok(warnings.some((w) => w.code === "safety_keyword_risk_mismatch"), "brake keyword with low risk flagged");
}

// --- fixture isolation: TEST_ONLY provider always marks isFixture --------
{
  const draft = await TEST_ONLY_mockCaseDraftProvider.proposeDraft({
    rawNarration: "Peugeot 206 cranked normally but would not start. Scanner showed zero RPM while cranking.",
  });
  ok(draft.isFixture === true, "mock provider output is always isFixture: true");
  ok(draft.origin === "ai_structured" && draft.aiTransformed === true, "mock provider marks ai_structured + aiTransformed");
  ok(draft.reviewStatus === "draft", "mock provider output is review-required (draft)");
  const result = validateCaseDraft(draft);
  ok(result.valid, "mock provider output passes structural validation");
  // Even though validation passes, the fixture flag blocks publication --
  // simulate the only path that would try.
  const asIfPublished = { ...draft, reviewStatus: "published", reviewedByProfileId: knownField("admin-1"), reviewedAt: knownField("now") };
  const publishAttempt = validateCaseDraft(asIfPublished);
  ok(!publishAttempt.valid, "fixture provider output can never be published, even with review metadata");
}

console.log(`automotive/knowledge/draft-contract.test.mjs: ${passed} checks passed`);
