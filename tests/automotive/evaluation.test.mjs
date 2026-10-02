// Minimal evaluation foundation exercised against clearly-marked fixture
// scenarios -- never real mechanic knowledge. Demonstrates what Milestone 2
// evaluation can measure: retrieval correctness, evidence grounding,
// correct next-check, safety behavior, and vehicle-applicability handling.
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
const evaluation = load("lib/automotive/evaluation.ts", { "./diagnosticContract": contract, "./types": {} });

const entries = FIXTURE_ENTRIES.filter((e) => e.isFixture);

// Fixture evaluation scenarios -- clearly marked, not real mechanic knowledge.
const scenarios = [
  {
    name: "fixture: no-start, no vehicle context -> clarification with both candidates",
    entries,
    query: { question: "engine cranks but does not start" },
    expect: { status: "clarification_needed", citedEntryIds: ["fx-1", "fx-2"] },
  },
  {
    name: "fixture: unmatched symptom -> insufficient data, no fabricated cause",
    entries,
    query: { question: "transmission makes a whining noise" },
    expect: { status: "insufficient_data" },
  },
  {
    name: "fixture: safety-critical brake symptom never carries action guidance",
    entries,
    query: { question: "soft brake pedal", allowActionGuidance: true },
    expect: { status: "grounded", citedEntryIds: ["fx-3"], neverActionableRiskLevels: ["safety_critical"] },
  },
  {
    name: "fixture: vehicle-specific entry requires vehicle context",
    entries: entries.filter((e) => e.id === "fx-2"),
    query: { question: "engine cranks but does not start" },
    expect: { status: "clarification_needed", requiresVehicleContext: true, nextDiagnosticStepIncludes: "fuel pressure" },
  },
];

const summary = evaluation.runEvaluationSuite(scenarios);
for (const r of summary.results) {
  assert.ok(r.pass, `${r.name}: ${r.failures.join("; ")}`);
}
assert.equal(summary.failed, 0, "all fixture evaluation scenarios pass");

console.log(`automotive evaluation: ${summary.passed} scenarios passed`);
