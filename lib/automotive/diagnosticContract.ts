// Track B -- the diagnostic reasoning contract. This is the deterministic/
// retrieval/safety foundation described in the milestone brief; narrative
// generation over its output is a separate, swappable concern (see
// llmProvider.ts). This module never invents a cause the retrieved evidence
// doesn't support, and never upgrades its own confidence based on how it is
// phrased.
//
// Milestone 2: every claim this module emits is structurally tied to an
// EvidenceItem id (see evidence.ts/claims.ts) and validated before it is
// returned. A possible cause is always a HYPOTHESIS, never a FACT -- FACT is
// reserved for what a knowledge entry literally documents, not for whether
// that applies to this car. Observations supplied for a diagnosis turn let
// candidates be narrowed (confirmed/ruled_out) instead of the system
// guessing a single cause up front.
import { retrieveKnowledge, type RetrievalOptions } from "./retrieval";
import { canProvideActionGuidance, safetyCriticalWarning } from "./safety";
import {
  EvidenceIndex,
  evidenceFromKnowledgeEntry,
  evidenceFromObservation,
  type EvidenceItem,
  type ObservationInput,
} from "./evidence";
import { validateClaims, type Claim } from "./claims";
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
 * Narrows retrieved entries using caller-supplied observations: an
 * observation that rules out an entry's diagnostic test removes it from the
 * candidate set; one that confirms it narrows the candidate set down to it.
 * Never invents an observation -- only acts on what the caller actually
 * supplied this turn.
 */
function narrowByObservations(matches: KnowledgeEntry[], observations: ObservationInput[]): KnowledgeEntry[] {
  const ruledOut = new Set(observations.filter((o) => o.result === "ruled_out" && o.relatedToEntryId).map((o) => o.relatedToEntryId));
  const confirmed = observations.filter((o) => o.result === "confirmed" && o.relatedToEntryId).map((o) => o.relatedToEntryId);

  let narrowed = matches.filter((e) => !ruledOut.has(e.id));
  if (confirmed.length > 0) {
    const confirmedMatches = narrowed.filter((e) => confirmed.includes(e.id));
    if (confirmedMatches.length > 0) narrowed = confirmedMatches;
  }
  return narrowed;
}

function buildClaims(
  status: DiagnosticResponse["status"],
  findings: CitedFinding[],
  observationItems: Array<{ item: EvidenceItem; input: ObservationInput }>,
  notes: string[],
): Claim[] {
  const claims: Claim[] = [];

  for (const { item, input } of observationItems) {
    claims.push({
      type: "OBSERVATION",
      text: input.content,
      evidenceIds: [item.id],
    });
  }

  for (const f of findings) {
    const entryEvidenceId = `evidence:entry:${f.entryId}`;
    claims.push({
      type: "FACT",
      text: `Knowledge entry ${f.entryId} (${f.sourceType}) documents: "${f.symptom}" with possible cause "${f.possibleCause}".`,
      evidenceIds: [entryEvidenceId],
      confidence: f.confidence,
      riskLevel: f.riskLevel,
    });

    const relatedObservationIds = observationItems
      .filter((o) => o.input.relatedToEntryId === f.entryId)
      .map((o) => o.item.id);

    claims.push({
      type: "HYPOTHESIS",
      text: `Possible cause for this vehicle: ${f.possibleCause}.`,
      evidenceIds: [entryEvidenceId, ...relatedObservationIds],
      confidence: f.confidence,
      riskLevel: f.riskLevel,
    });

    if (f.nextDiagnosticStep) {
      claims.push({
        type: "RECOMMENDED_NEXT_CHECK",
        text: f.nextDiagnosticStep,
        evidenceIds: [entryEvidenceId],
      });
    }

    if (f.riskLevel === "safety_critical") {
      claims.push({
        type: "SAFETY_NOTICE",
        text: safetyCriticalWarning(f.system),
        evidenceIds: [entryEvidenceId],
        riskLevel: f.riskLevel,
      });
    }
  }

  if (status === "insufficient_data") {
    claims.push({
      type: "INSUFFICIENT_EVIDENCE",
      text: notes.join(" "),
      evidenceIds: [],
    });
  }

  return claims;
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
  const observationInputs = query.observations ?? [];
  const observationItems = observationInputs.map((input, i) => ({ item: evidenceFromObservation(input, i), input }));

  const retrieved = retrieveKnowledge(entries, query, retrievalOptions);
  const matches = narrowByObservations(retrieved, observationInputs);

  if (matches.length === 0) {
    const notes = ["No published knowledge entry matched this question. Insufficient data to ground an answer -- this is not a guess."];
    const evidence = observationItems.map((o) => o.item);
    const claims = buildClaims("insufficient_data", [], observationItems, notes);
    validateClaims(claims, new EvidenceIndex(evidence));
    return {
      status: "insufficient_data",
      findings: [],
      clarifyingQuestions: [
        "What symptom are you seeing, and under what conditions does it happen?",
        "What is the vehicle's make, model, and year?",
      ],
      notes,
      evidence,
      claims,
    };
  }

  const findings = matches.map((entry) => toCitedFinding(entry, query));
  const confirmedEntryIds = new Set(
    observationInputs.filter((o) => o.result === "confirmed" && o.relatedToEntryId).map((o) => o.relatedToEntryId),
  );
  const narrowedToOne = matches.length === 1 && confirmedEntryIds.has(matches[0].id);

  const needsVehicle = !narrowedToOne && !query.vehicle && matches.some((m) => (m.vehicleApplicability?.length ?? 0) > 0);
  const tooManyMatches = !narrowedToOne && matches.length > 3;

  const clarifyingQuestions: string[] = [];
  if (needsVehicle) clarifyingQuestions.push("What is the vehicle's make, model, and year?");
  if (tooManyMatches) clarifyingQuestions.push("Can you narrow the symptom further (when it happens, any warning lights, recent work done)?");
  for (const f of findings) {
    const alreadyTested = observationInputs.some((o) => o.relatedToEntryId === f.entryId && o.result);
    if (f.nextDiagnosticStep && !alreadyTested) clarifyingQuestions.push(`Have you performed this check: ${f.nextDiagnosticStep}?`);
  }

  const notes: string[] = [];
  for (const f of findings) {
    if (f.riskLevel === "safety_critical") notes.push(safetyCriticalWarning(f.system));
  }

  const status = needsVehicle || tooManyMatches ? "clarification_needed" : "grounded";
  const knowledgeEvidence = matches.map((e) => evidenceFromKnowledgeEntry(e));
  const evidence = [...knowledgeEvidence, ...observationItems.map((o) => o.item)];
  const claims = buildClaims(status, findings, observationItems, notes);
  validateClaims(claims, new EvidenceIndex(evidence));

  return {
    status,
    findings,
    clarifyingQuestions,
    notes,
    evidence,
    claims,
  };
}
