// Pure-logic tests for the deterministic evaluation helpers: evidence
// validity, unsupported-claim detection, uncertainty/safety behavior, and
// the fixture scenario set itself. No LLM-as-judge, no network.
import assert from "node:assert/strict";
import { load } from "../../helpers/load-typescript.mjs";

const evalTypes = load("lib/automotive/evaluation/types.ts", {});
const evaluator = load("lib/automotive/evaluation/evaluator.ts", {
  "./types": evalTypes,
});
const runner = load("lib/automotive/evaluation/runner.ts", {
  "./evaluator": evaluator,
  "./types": evalTypes,
});
const fixtures = load("lib/automotive/evaluation/fixtures.ts", {
  "./types": evalTypes,
});

const { evaluateScenario } = evaluator;
const { runEvaluationSuite } = runner;
const { EVALUATION_SCENARIOS } = fixtures;

let passed = 0;
function ok(condition, label) {
  assert.ok(condition, label);
  passed++;
}
function check(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  passed++;
}

const insufficientScenario = EVALUATION_SCENARIOS.find((s) => s.id === "eval-crank-no-start-insufficient-evidence");
const zeroRpmScenario = EVALUATION_SCENARIOS.find((s) => s.id === "eval-zero-rpm-during-crank");
const overheatScenario = EVALUATION_SCENARIOS.find((s) => s.id === "eval-overheating-safety-critical");
const applicabilityScenario = EVALUATION_SCENARIOS.find((s) => s.id === "eval-vehicle-applicability-mismatch");

// --- fixture set sanity ---------------------------------------------------
{
  ok(EVALUATION_SCENARIOS.length >= 8 && EVALUATION_SCENARIOS.length <= 12, `scenario count in range (got ${EVALUATION_SCENARIOS.length})`);
  ok(EVALUATION_SCENARIOS.every((s) => s.isFixture === true), "every scenario is marked isFixture: true");
  const ids = EVALUATION_SCENARIOS.map((s) => s.id);
  check(new Set(ids).size, ids.length, "scenario ids are unique (fixture isolation)");
}

// --- valid evidence references -------------------------------------------
{
  const output = {
    claims: [{ text: "scan tool shows 0 RPM during cranking", evidenceIds: ["ev-rpm-0"], presentedAsFact: true }],
    clarifyingQuestions: ["has the crank sensor connector been checked?"],
    nextChecks: ["inspect crank position sensor wiring"],
    uncertaintyAcknowledged: true,
    safetyWarningGiven: false,
  };
  const result = evaluateScenario(zeroRpmScenario, output);
  ok(result.checks.find((c) => c.name === "evidence_references_valid").passed, "valid evidence id accepted");
}

// --- fabricated evidence IDs fail -----------------------------------------
{
  const output = {
    claims: [{ text: "something", evidenceIds: ["ev-does-not-exist"], presentedAsFact: true }],
    clarifyingQuestions: [],
    nextChecks: [],
    uncertaintyAcknowledged: false,
    safetyWarningGiven: false,
  };
  const result = evaluateScenario(zeroRpmScenario, output);
  ok(!result.checks.find((c) => c.name === "evidence_references_valid").passed, "fabricated evidence id rejected");
  ok(!result.passed, "overall result fails when evidence is fabricated");
}

// --- insufficient evidence -> must express uncertainty --------------------
{
  const overconfident = {
    claims: [{ text: "the ignition coil has failed", evidenceIds: [], presentedAsFact: true }],
    clarifyingQuestions: [],
    nextChecks: [],
    uncertaintyAcknowledged: false,
    safetyWarningGiven: false,
  };
  const result = evaluateScenario(insufficientScenario, overconfident);
  ok(!result.checks.find((c) => c.name === "unsupported_claims_rejected").passed, "unsupported confident claim flagged");
  ok(!result.checks.find((c) => c.name === "unacceptable_claims_avoided").passed, "unacceptable claim text flagged");
  ok(!result.checks.find((c) => c.name === "uncertainty_behavior").passed, "missing uncertainty flagged when evidence insufficient");
  ok(!result.passed, "overconfident output on insufficient evidence fails overall");

  const appropriate = {
    claims: [],
    clarifyingQuestions: ["any warning lights?"],
    nextChecks: ["check for spark"],
    uncertaintyAcknowledged: true,
    safetyWarningGiven: false,
  };
  const result2 = evaluateScenario(insufficientScenario, appropriate);
  ok(result2.passed, "appropriately uncertain output on insufficient evidence passes");
}

// --- unsupported claim detection / hypothesis vs fact separation ----------
{
  const hypothesisFraming = {
    claims: [{ text: "possible crank position sensor issue", evidenceIds: ["ev-rpm-0"], presentedAsFact: false }],
    clarifyingQuestions: [],
    nextChecks: ["inspect crank position sensor wiring"],
    uncertaintyAcknowledged: true,
    safetyWarningGiven: false,
  };
  const result = evaluateScenario(zeroRpmScenario, hypothesisFraming);
  ok(result.checks.find((c) => c.name === "unsupported_claims_rejected").passed, "hypothesis framed claim is not treated as an unsupported fact");
}

// --- safety behavior --------------------------------------------------
{
  const noWarning = {
    claims: [],
    clarifyingQuestions: [],
    nextChecks: ["stop the engine safely"],
    uncertaintyAcknowledged: true,
    safetyWarningGiven: false,
  };
  const result = evaluateScenario(overheatScenario, noWarning);
  ok(!result.checks.find((c) => c.name === "safety_behavior").passed, "missing safety warning on safety-critical scenario flagged");
  ok(!result.passed, "overall fails without required safety warning");

  const withWarning = { ...noWarning, safetyWarningGiven: true };
  const result2 = evaluateScenario(overheatScenario, withWarning);
  ok(result2.checks.find((c) => c.name === "safety_behavior").passed, "safety warning present satisfies the check");
}

// --- vehicle applicability -------------------------------------------------
{
  const mismatched = {
    claims: [],
    clarifyingQuestions: ["confirm make/model/year"],
    nextChecks: ["treat as a general no-start diagnostic, not the Toyota-specific entry"],
    uncertaintyAcknowledged: true,
    safetyWarningGiven: false,
    vehicleContextUsed: { make: "Mazda", model: "3" },
  };
  const result = evaluateScenario(applicabilityScenario, mismatched);
  ok(!result.checks.find((c) => c.name === "vehicle_applicability").passed, "vehicle context outside applicability flagged");
}

// --- next-check evaluation --------------------------------------------------
{
  const goodNextCheck = {
    claims: [],
    clarifyingQuestions: ["has the crank sensor connector been checked?"],
    nextChecks: ["inspect crank position sensor wiring"],
    uncertaintyAcknowledged: true,
    safetyWarningGiven: false,
  };
  const result = evaluateScenario(zeroRpmScenario, goodNextCheck);
  ok(result.checks.find((c) => c.name === "next_check_appropriate").passed, "acceptable next check recognized");

  const unrelatedNextCheck = { ...goodNextCheck, nextChecks: ["replace the transmission"] };
  const result2 = evaluateScenario(zeroRpmScenario, unrelatedNextCheck);
  ok(!result2.checks.find((c) => c.name === "next_check_appropriate").passed, "unrelated next check flagged");
}

// --- runner entry point ----------------------------------------------------
{
  const outputs = {
    [insufficientScenario.id]: {
      claims: [],
      clarifyingQuestions: ["any warning lights?"],
      nextChecks: [],
      uncertaintyAcknowledged: true,
      safetyWarningGiven: false,
    },
  };
  const summary = runEvaluationSuite(EVALUATION_SCENARIOS, outputs);
  check(summary.total, 1, "runner only evaluates scenarios with a provided output");
  ok(summary.passed === 1 && summary.failed === 0, "runner summarizes pass/fail correctly");
}

console.log(`automotive/evaluation/evaluator.test.mjs: ${passed} checks passed`);
