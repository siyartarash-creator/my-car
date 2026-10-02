// Track B -- LLM integration boundary. No paid external LLM is wired up (the
// $0 external-spend gate); this interface lets the deterministic contract's
// output be turned into prose/structured reasoning later (local-compatible
// model, or a paid API once authorized) without changing runDiagnosticQuery
// itself. The mock provider only narrates/echoes what is already in the
// DiagnosticResponse -- it never adds unsupported claims.
//
// Milestone 2: a future real provider receives a normalized, structured
// request (question, vehicle context, evidence, safety constraints) and must
// return structured output that validates against the claim/evidence
// contract (lib/automotive/claims.ts). Output that cites nonexistent
// evidence, misclassifies an inference as FACT, or violates the safety gate
// is rejected here -- the application falls back to the deterministic
// narrative rather than accepting it. This boundary assumes no tool
// execution capability (read-only-by-construction, per the obd-mcp-server
// principle noted in the milestone brief): a provider only returns text/
// claims, it never invokes an action.
import { filterValidClaims, validateClaims, ClaimValidationError, type Claim } from "./claims";
import { EvidenceIndex, type EvidenceItem } from "./evidence";
import type { DiagnosticQuery, DiagnosticResponse } from "./types";

export interface DiagnosticNarrationProvider {
  narrate(response: DiagnosticResponse, query: DiagnosticQuery): Promise<string>;
}

export const mockNarrationProvider: DiagnosticNarrationProvider = {
  async narrate(response, query) {
    if (response.status === "insufficient_data") {
      return `I don't have enough grounded knowledge to answer "${query.question}" yet. ${response.notes.join(" ")}`;
    }
    const lines: string[] = [];
    for (const f of response.findings) {
      lines.push(
        `- [${f.entryId}] (${f.sourceType}, confidence: ${f.confidence}, risk: ${f.riskLevel}) ${f.symptom} -> possible cause: ${f.possibleCause}` +
          (f.nextDiagnosticStep ? ` | next check: ${f.nextDiagnosticStep}` : "") +
          (f.actionGuidance ? ` | action: ${f.actionGuidance}` : ""),
      );
    }
    if (response.status === "clarification_needed") {
      lines.push("", "Before narrowing further:", ...response.clarifyingQuestions.map((q) => `- ${q}`));
    }
    if (response.notes.length) lines.push("", ...response.notes);
    return lines.join("\n");
  },
};

/** What a structured reasoning provider (future local/paid LLM) receives. Read-only: no
 * tool/action-execution capability is granted through this contract. */
export interface StructuredReasoningRequest {
  question: string;
  vehicle: DiagnosticQuery["vehicle"];
  evidence: EvidenceItem[];
  safetyConstraints: {
    allowActionGuidance: boolean;
    /** riskLevel values for which action guidance may never be returned, regardless of authorization. */
    neverActionableRiskLevels: ReadonlyArray<"safety_critical">;
  };
}

/** What a structured reasoning provider must return -- validated before acceptance. */
export interface StructuredReasoningResult {
  claims: Claim[];
}

export function buildStructuredRequest(query: DiagnosticQuery, evidence: EvidenceItem[]): StructuredReasoningRequest {
  return {
    question: query.question,
    vehicle: query.vehicle,
    evidence,
    safetyConstraints: {
      allowActionGuidance: query.allowActionGuidance === true,
      neverActionableRiskLevels: ["safety_critical"],
    },
  };
}

/**
 * Validates a structured provider result against the evidence it was given.
 * Returns the claims that may be accepted, or null if the result must be
 * rejected outright (fall back to the deterministic narrative/mock
 * provider). A provider is never trusted merely because it returned
 * well-formed JSON -- every claim's evidence references and claim-type
 * rules are re-checked here, independent of what the provider "intended".
 */
export function validateStructuredResult(
  result: StructuredReasoningResult,
  request: StructuredReasoningRequest,
): Claim[] | null {
  if (!result || !Array.isArray(result.claims)) return null;
  const index = new EvidenceIndex(request.evidence);

  try {
    validateClaims(result.claims, index);
    return result.claims;
  } catch (err) {
    if (err instanceof ClaimValidationError) {
      // Fall back to filtering rather than rejecting wholesale, so one bad claim doesn't
      // discard an otherwise-valid structured response -- but nothing invalid ever renders.
      return filterValidClaims(result.claims, index);
    }
    return null;
  }
}
