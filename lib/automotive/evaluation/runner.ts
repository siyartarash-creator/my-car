// Track B (parallel worker) -- deterministic evaluation runner entry point.
// No LLM-as-judge, no paid AI. Runs evaluateScenario across a scenario set
// against a map of candidate outputs and summarizes pass/fail. Intended for
// local use and future wiring into Automotive AI Core's own test outputs.
import { evaluateScenario, type EvaluationResult } from "./evaluator";
import type { CandidateDiagnosticOutput, EvaluationScenario } from "./types";

export interface EvaluationSuiteSummary {
  total: number;
  passed: number;
  failed: number;
  results: EvaluationResult[];
}

/**
 * Runs every scenario that has a corresponding entry in `outputsByScenarioId`.
 * Scenarios with no matching output are skipped (not counted as failures) --
 * this runner measures candidate output quality, not fixture completeness.
 */
export function runEvaluationSuite(
  scenarios: EvaluationScenario[],
  outputsByScenarioId: Record<string, CandidateDiagnosticOutput>,
): EvaluationSuiteSummary {
  const results: EvaluationResult[] = [];
  for (const scenario of scenarios) {
    const output = outputsByScenarioId[scenario.id];
    if (!output) continue;
    results.push(evaluateScenario(scenario, output));
  }
  const passed = results.filter((r) => r.passed).length;
  return { total: results.length, passed, failed: results.length - passed, results };
}
