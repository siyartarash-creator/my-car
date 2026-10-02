// Track B Milestone 2 -- minimal evaluation contract. Not a benchmark
// platform: a small, deterministic scenario runner over runDiagnosticQuery,
// cheap enough to run locally on every change. No LLM judge, no paid
// service -- every assertion here is a structural check against the
// response contract (retrieval correctness, evidence grounding, unsupported
// claims, uncertainty, next-check correctness, safety behavior, vehicle
// applicability). Scenarios must use fixture data (isFixture: true); this
// module never represents its scenarios as real mechanic knowledge.
import { runDiagnosticQuery } from "./diagnosticContract";
import type { DiagnosticQuery, KnowledgeEntry } from "./types";

export interface EvalScenario {
  name: string;
  entries: KnowledgeEntry[];
  query: DiagnosticQuery;
  expect: {
    status: "grounded" | "clarification_needed" | "insufficient_data";
    citedEntryIds?: string[];
    nextDiagnosticStepIncludes?: string;
    /** risk levels that must never carry actionGuidance in the response. */
    neverActionableRiskLevels?: Array<KnowledgeEntry["riskLevel"]>;
    requiresVehicleContext?: boolean;
  };
}

export interface EvalResult {
  name: string;
  pass: boolean;
  failures: string[];
}

export function runScenario(scenario: EvalScenario): EvalResult {
  const failures: string[] = [];
  const response = runDiagnosticQuery(scenario.entries, scenario.query, { includeFixtures: true });

  if (response.status !== scenario.expect.status) {
    failures.push(`expected status "${scenario.expect.status}", got "${response.status}"`);
  }

  if (scenario.expect.citedEntryIds) {
    const got = response.findings.map((f) => f.entryId).sort();
    const want = [...scenario.expect.citedEntryIds].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      failures.push(`expected cited entries ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    }
  }

  if (scenario.expect.nextDiagnosticStepIncludes) {
    const found = response.findings.some((f) => f.nextDiagnosticStep?.includes(scenario.expect.nextDiagnosticStepIncludes!));
    if (!found) failures.push(`expected a next diagnostic step mentioning "${scenario.expect.nextDiagnosticStepIncludes}"`);
  }

  for (const risk of scenario.expect.neverActionableRiskLevels ?? []) {
    const violated = response.findings.some((f) => f.riskLevel === risk && f.actionGuidance !== null);
    if (violated) failures.push(`risk level "${risk}" must never carry action guidance in this scenario`);
  }

  if (scenario.expect.requiresVehicleContext) {
    if (!response.clarifyingQuestions.some((q) => q.toLowerCase().includes("make"))) {
      failures.push("expected a clarifying question requesting vehicle make/model/year");
    }
  }

  // Structural grounding check that holds for every scenario: every FACT/
  // HYPOTHESIS claim must cite evidence that is actually present.
  const evidenceIds = new Set(response.evidence.map((e) => e.id));
  for (const claim of response.claims) {
    for (const id of claim.evidenceIds) {
      if (!evidenceIds.has(id)) failures.push(`claim "${claim.type}" cites evidence id "${id}" not present in response.evidence`);
    }
  }

  return { name: scenario.name, pass: failures.length === 0, failures };
}

export function runEvaluationSuite(scenarios: EvalScenario[]): { results: EvalResult[]; passed: number; failed: number } {
  const results = scenarios.map(runScenario);
  return {
    results,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
  };
}
