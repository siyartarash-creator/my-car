// Tests for the Mehdi real-knowledge intake validation contract. Confirms
// the tooling cannot submit an unconfirmed/fabricated case and that a
// well-formed real case passes validation into a draft-status shape only.
import assert from "node:assert/strict";
import { load } from "../helpers/load-typescript.mjs";

const caseIntake = load("lib/automotive/caseIntake.ts", { "./types": {} });

let passed = 0;
function check(cond, label) {
  assert.ok(cond, label);
  passed++;
}

// --- unconfirmed case is rejected regardless of content quality ----------
{
  assert.throws(
    () =>
      caseIntake.parseCaseIntakeDraft({
        confirmedRealCase: false,
        authorProfileId: "a0000000-0000-0000-0000-000000000001",
        observed: "Peugeot 206 cranked but would not start.",
        diagnosis: "Crank sensor failure, zero RPM on scanner during cranking.",
        resolution: "Replaced crank sensor; vehicle started and ran normally.",
      }),
    caseIntake.CaseIntakeValidationError,
    "unconfirmed case is rejected",
  );
  passed++;
}

// --- a confirmed, well-formed real case produces a draft-only shape -------
{
  const draft = caseIntake.parseCaseIntakeDraft({
    confirmedRealCase: true,
    authorProfileId: "a0000000-0000-0000-0000-000000000001",
    vehicleApplicability: [{ make: "Peugeot", model: "206" }],
    observed: "Cranked normally but would not start; scanner showed zero RPM while cranking.",
    diagnosis: "Crank position sensor signal failure.",
    diagnosticTest: "Checked crank sensor wiring and connector.",
    resolution: "Replaced crank sensor and connector; vehicle started and idled normally.",
    uncertaintyNotes: "Did not test the sensor in isolation before replacement.",
  });
  check(draft.status === "draft", "parsed case is always status=draft, never reviewed/published");
  check(draft.observed.includes("zero RPM"), "observed content preserved");
  passed++;
}

// --- missing required field is rejected -----------------------------------
{
  assert.throws(
    () =>
      caseIntake.parseCaseIntakeDraft({
        confirmedRealCase: true,
        authorProfileId: "a0000000-0000-0000-0000-000000000001",
        observed: "",
        diagnosis: "x",
        resolution: "x",
      }),
    caseIntake.CaseIntakeValidationError,
    "empty observed field is rejected",
  );
  passed++;
}

console.log(`automotive case-intake: ${passed} checks passed`);
