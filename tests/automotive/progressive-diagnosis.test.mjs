// Tests for progressive diagnosis: the system must not jump to a single
// cause up front, must ask for the discriminating check, and must narrow
// candidates once an observation confirms/rules one out -- without ever
// fabricating the observation itself.
import assert from "node:assert/strict";
import { load } from "../helpers/load-typescript.mjs";
import { FIXTURE_ENTRIES } from "./fixtures.mjs";

const evidence = load("lib/automotive/evidence.ts", { "./types": {} });
const claims = load("lib/automotive/claims.ts", { "./evidence": evidence, "./types": {} });
const safety = load("lib/automotive/safety.ts");
const retrieval = load("lib/automotive/retrieval.ts", { "./types": {} });
const contract = load("lib/automotive/diagnosticContract.ts", {
  "./retrieval": retrieval,
  "./safety": safety,
  "./evidence": evidence,
  "./claims": claims,
  "./types": {},
});

let passed = 0;
function check(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  passed++;
}

const entries = FIXTURE_ENTRIES.filter((e) => e.isFixture);

// --- first turn: no premature single-cause declaration --------------------
{
  const response = contract.runDiagnosticQuery(entries, { question: "engine cranks but does not start" }, { includeFixtures: true });
  check(response.findings.length > 1, true, "multiple candidate causes surfaced, not one declared answer");
  check(response.clarifyingQuestions.length > 0, true, "asks for discriminating information instead of guessing");
}

// --- second turn: an observation rules out a candidate ---------------------
{
  const response = contract.runDiagnosticQuery(
    entries,
    {
      question: "engine cranks but does not start",
      vehicle: { make: "Toyota" },
      observations: [
        { type: "diagnostic_test_result", content: "visible spark present at the plug", relatedToEntryId: "fx-1", result: "ruled_out" },
      ],
    },
    { includeFixtures: true },
  );
  check(response.findings.map((f) => f.entryId), ["fx-2"], "ruled-out candidate removed, remaining candidate narrowed");
  check(response.evidence.some((e) => e.type === "diagnostic_test_result"), true, "the supplied observation is tracked as evidence");
}

// --- third turn: a confirming observation narrows to one and stops asking
//     about the check that was already performed ---------------------------
{
  const response = contract.runDiagnosticQuery(
    entries,
    {
      question: "engine cranks but does not start",
      vehicle: { make: "Toyota" },
      observations: [
        { type: "diagnostic_test_result", content: "no spark at the plug", relatedToEntryId: "fx-1", result: "confirmed" },
      ],
    },
    { includeFixtures: true },
  );
  check(response.findings.map((f) => f.entryId), ["fx-1"], "confirmed candidate narrows the result to a single finding");
  check(response.status, "grounded", "narrowed-to-one via confirmation is grounded, not still asking for vehicle/ambiguity clarification");
  check(
    response.clarifyingQuestions.some((q) => q.includes("check for spark")),
    false,
    "does not re-ask about a check the observation already answered",
  );
}

console.log(`automotive progressive-diagnosis: ${passed} checks passed`);
