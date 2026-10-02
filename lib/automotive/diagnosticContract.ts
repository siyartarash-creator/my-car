// Track B -- the diagnostic reasoning contract. This is the deterministic/
// retrieval/safety foundation described in the milestone brief; narrative
// generation over its output is a separate, swappable concern (see
// llmProvider.ts). This module never invents a cause the retrieved evidence
// doesn't support, and never upgrades its own confidence based on how it is
// phrased.
import { retrieveKnowledge, type RetrievalOptions } from "./retrieval";
import { canProvideActionGuidance, safetyCriticalWarning } from "./safety";
import type { CitedFinding, DiagnosticQuery, DiagnosticResponse, KnowledgeEntry } from "./types";

function toCitedFinding(entry: KnowledgeEntry, query: DiagnosticQuery): CitedFinding {
  const actionAllowed = canProvideActionGuidance(entry.riskLevel, query.allowActionGuidance);
  return {
    entryId: entry.id,
    sourceType: entry.sourceType,
    confidence: entry.confidence,
    riskLevel: entry.riskLevel,
    system: entry.system,
    symptom: entry.symptom,
    possibleCause: entry.possibleCause,
    nextDiagnosticStep: entry.diagnosticTest ?? null,
    actionGuidance: actionAllowed ? (entry.repairAction ?? null) : null,
  };
}

/**
 * Runs the full question -> evidence -> safety -> grounded-response pipeline
 * against an already-fetched set of knowledge entries. Callers are
 * responsible for fetching entries (DB-backed in production, fixtures in
 * tests) -- this function is pure and DB-agnostic so it is cheap to test.
 */
export function runDiagnosticQuery(
  entries: KnowledgeEntry[],
  query: DiagnosticQuery,
  retrievalOptions: RetrievalOptions = {},
): DiagnosticResponse {
  const matches = retrieveKnowledge(entries, query, retrievalOptions);

  if (matches.length === 0) {
    return {
      status: "insufficient_data",
      findings: [],
      clarifyingQuestions: [
        "What symptom are you seeing, and under what conditions does it happen?",
        "What is the vehicle's make, model, and year?",
      ],
      notes: ["No published knowledge entry matched this question. Insufficient data to ground an answer -- this is not a guess."],
    };
  }

  const findings = matches.map((entry) => toCitedFinding(entry, query));
  const needsVehicle = !query.vehicle && matches.some((m) => (m.vehicleApplicability?.length ?? 0) > 0);
  const tooManyMatches = matches.length > 3;

  const clarifyingQuestions: string[] = [];
  if (needsVehicle) clarifyingQuestions.push("What is the vehicle's make, model, and year?");
  if (tooManyMatches) clarifyingQuestions.push("Can you narrow the symptom further (when it happens, any warning lights, recent work done)?");
  for (const f of findings) {
    if (f.nextDiagnosticStep) clarifyingQuestions.push(`Have you performed this check: ${f.nextDiagnosticStep}?`);
  }

  const notes: string[] = [];
  for (const f of findings) {
    if (f.riskLevel === "safety_critical") notes.push(safetyCriticalWarning(f.system));
  }

  return {
    status: needsVehicle || tooManyMatches ? "clarification_needed" : "grounded",
    findings,
    clarifyingQuestions,
    notes,
  };
}
