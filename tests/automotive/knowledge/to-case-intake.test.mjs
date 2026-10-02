// Tests for the StructuredCaseDraft -> CaseIntakeDraftInput adapter: the
// seam between the draft-authoring layer and Core's real-case intake
// validation (lib/automotive/caseIntake.ts), which remains the single
// source of truth for what can become an automotive_case_intake row.
import assert from "node:assert/strict";
import { load } from "../../helpers/load-typescript.mjs";

const caseIntake = load("lib/automotive/caseIntake.ts", { "./types": {} });
const knowledgeTypes = load("lib/automotive/knowledge/types.ts", {});
const toCaseIntake = load("lib/automotive/knowledge/toCaseIntake.ts", {
  "../caseIntake": caseIntake,
  "./types": knowledgeTypes,
});

const { unknownField, knownField } = knowledgeTypes;
const { draftToCaseIntakeInput, DraftNotReadyForIntakeError } = toCaseIntake;

let passed = 0;
function check(cond, label) {
  assert.ok(cond, label);
  passed++;
}

function baseDraft(overrides = {}) {
  return {
    id: "draft-1",
    sourceCaseId: null,
    vehicle: {
      make: knownField("Peugeot"),
      model: knownField("206"),
      yearFrom: unknownField(),
      yearTo: unknownField(),
      engineVariant: unknownField(),
    },
    reportedSymptoms: "cranked normally but would not start",
    mechanicObservations: knownField("scanner showed zero RPM while cranking"),
    diagnosticTestsPerformed: knownField("checked crank sensor wiring and connector"),
    measuredResults: unknownField(),
    candidateCauses: ["crank position sensor fault"],
    confirmedCause: knownField("crank position sensor fault"),
    repairActionPerformed: knownField("replaced crank sensor and connector"),
    outcome: knownField("vehicle started and idled normally"),
    mechanicNotes: unknownField(),
    origin: "mechanic_authored",
    provenance: "mechanic_authored",
    confidence: "high",
    riskLevel: "routine_safe",
    reviewStatus: "reviewed",
    isFixture: false,
    aiTransformed: false,
    reviewedByProfileId: unknownField(),
    reviewedAt: unknownField(),
    ...overrides,
  };
}

// --- a completed draft adapts into a valid Core intake input -------------
{
  const draft = baseDraft();
  const input = draftToCaseIntakeInput(draft, {
    confirmedRealCase: true,
    authorProfileId: "a0000000-0000-0000-0000-000000000001",
  });
  const parsed = caseIntake.parseCaseIntakeDraft(input);
  check(parsed.status === "draft", "adapted input passes Core's own intake validation");
  check(parsed.observed.includes("zero RPM"), "observed content carried through");
  check(parsed.resolution.includes("replaced crank sensor"), "resolution carried through");
  check(input.vehicleApplicability[0].make === "Peugeot", "vehicle applicability carried through");
}

// --- fixture drafts can never reach intake, regardless of completeness ---
{
  const draft = baseDraft({ isFixture: true, origin: "fixture" });
  assert.throws(
    () => draftToCaseIntakeInput(draft, { confirmedRealCase: true, authorProfileId: "a0000000-0000-0000-0000-000000000001" }),
    DraftNotReadyForIntakeError,
    "fixture draft rejected before it ever reaches Core's intake validation",
  );
  passed++;
}

// --- an in-progress draft (no confirmed repair/outcome) is not ready -----
{
  const draft = baseDraft({ repairActionPerformed: unknownField(), outcome: unknownField() });
  assert.throws(
    () => draftToCaseIntakeInput(draft, { confirmedRealCase: true, authorProfileId: "a0000000-0000-0000-0000-000000000001" }),
    DraftNotReadyForIntakeError,
    "draft without a confirmed repair/outcome is not converted into intake input",
  );
  passed++;
}

// --- confirmedRealCase is never set by inference -- only by explicit call --
{
  const draft = baseDraft();
  const input = draftToCaseIntakeInput(draft, {
    confirmedRealCase: true,
    authorProfileId: "a0000000-0000-0000-0000-000000000001",
  });
  check(input.confirmedRealCase === true, "confirmedRealCase is passed through verbatim from the explicit confirmation, never read off the draft");
}

console.log(`automotive/knowledge/to-case-intake.test.mjs: ${passed} checks passed`);
