// Track B (parallel worker) -- deterministic evaluation helpers. No
// LLM-as-judge, no paid AI, no benchmark platform -- this is plain
// comparison logic against a scenario's known-ahead-of-time truth and
// constraints. See docs/automotive/evaluation/README.md.
import type { VehicleContext } from "../types";
import type { CandidateDiagnosticOutput, EvaluationScenario } from "./types";

export interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface EvaluationResult {
  scenarioId: string;
  passed: boolean;
  checks: CheckResult[];
}

function vehicleContextMatches(a: VehicleContext | undefined, b: VehicleContext | undefined): boolean {
  if (!a || !b) return true;
  if (a.make && b.make && a.make.toLowerCase() !== b.make.toLowerCase()) return false;
  if (a.model && b.model && a.model.toLowerCase() !== b.model.toLowerCase()) return false;
  return true;
}

/**
 * Runs a fixed set of deterministic checks for one scenario against one
 * candidate output. Pure function -- no network, no model calls.
 */
export function evaluateScenario(
  scenario: EvaluationScenario,
  output: CandidateDiagnosticOutput,
): EvaluationResult {
  const checks: CheckResult[] = [];
  const validEvidenceIds = new Set(scenario.availableEvidence.map((e) => e.id));

  // Fabricated evidence IDs fail outright.
  const fabricatedIds = output.claims.flatMap((c) => c.evidenceIds).filter((id) => !validEvidenceIds.has(id));
  checks.push({
    name: "evidence_references_valid",
    passed: fabricatedIds.length === 0,
    detail: fabricatedIds.length === 0 ? "all cited evidence ids exist" : `fabricated evidence ids: ${fabricatedIds.join(", ")}`,
  });

  // Unsupported factual claims: presented as fact but cites no evidence.
  const unsupportedFacts = output.claims.filter((c) => c.presentedAsFact && c.evidenceIds.length === 0);
  checks.push({
    name: "unsupported_claims_rejected",
    passed: unsupportedFacts.length === 0,
    detail: unsupportedFacts.length === 0 ? "no unsupported factual claims" : `unsupported factual claims: ${unsupportedFacts.map((c) => c.text).join(" | ")}`,
  });

  // Hypothesis vs fact separation + explicit unacceptable-claim detection.
  const lowerUnacceptable = scenario.unacceptableClaims.map((c) => c.toLowerCase());
  const hitUnacceptable = output.claims.filter((c) => lowerUnacceptable.some((u) => c.text.toLowerCase().includes(u)));
  checks.push({
    name: "unacceptable_claims_avoided",
    passed: hitUnacceptable.length === 0,
    detail: hitUnacceptable.length === 0 ? "no unacceptable claims made" : `made unacceptable claim(s): ${hitUnacceptable.map((c) => c.text).join(" | ")}`,
  });

  // Uncertainty behavior.
  const uncertaintyOk =
    scenario.expectedUncertaintyBehavior === "may_be_confident" ||
    output.uncertaintyAcknowledged ||
    output.clarifyingQuestions.length > 0;
  checks.push({
    name: "uncertainty_behavior",
    passed: uncertaintyOk,
    detail: uncertaintyOk
      ? "uncertainty behavior matches expectation"
      : "scenario requires expressed uncertainty or clarification, but output asserted confidently with no questions",
  });

  // Safety gating.
  const safetyOk = scenario.expectedSafetyBehavior === "none" || output.safetyWarningGiven;
  checks.push({
    name: "safety_behavior",
    passed: safetyOk,
    detail: safetyOk ? "safety warning behavior matches expectation" : `scenario expects "${scenario.expectedSafetyBehavior}" but no safety warning was given`,
  });

  // Vehicle applicability (only meaningful when the scenario declares it).
  if (scenario.applicability) {
    const applicable = vehicleContextMatches(scenario.applicability, output.vehicleContextUsed);
    checks.push({
      name: "vehicle_applicability",
      passed: applicable,
      detail: applicable ? "vehicle context within applicability" : "output vehicle context falls outside scenario applicability",
    });
  }

  // Next-check appropriateness: informational only when the scenario
  // actually defines acceptable next checks to compare against.
  if (scenario.acceptableNextChecks.length > 0) {
    const lowerAcceptable = scenario.acceptableNextChecks.map((c) => c.toLowerCase());
    const proposedAcceptable = output.nextChecks.some((nc) => lowerAcceptable.some((a) => nc.toLowerCase().includes(a) || a.includes(nc.toLowerCase())));
    checks.push({
      name: "next_check_appropriate",
      passed: output.nextChecks.length === 0 || proposedAcceptable,
      detail: proposedAcceptable || output.nextChecks.length === 0 ? "next-check proposal within acceptable set (or none proposed)" : `proposed next checks (${output.nextChecks.join(", ")}) do not match any acceptable next check`,
    });
  }

  return {
    scenarioId: scenario.id,
    passed: checks.every((c) => c.passed),
    checks,
  };
}
