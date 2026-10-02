// Track B Milestone 2 -- claim/evidence contract. Important diagnostic
// output is structured claims, not free text that gets citations bolted on
// afterward. A claim presented as evidence-grounded (FACT, SAFETY_NOTICE)
// must reference evidence that actually exists in this response; a
// HYPOTHESIS may exist with partial evidence but must stay visibly a
// hypothesis. Unknown evidence IDs fail validation -- this is the structural
// enforcement point, not a prompt instruction.
import type { EvidenceIndex } from "./evidence";
import type { ConfidenceLevel, RiskLevel } from "./types";

export type ClaimType =
  | "FACT"
  | "OBSERVATION"
  | "HYPOTHESIS"
  | "RECOMMENDED_NEXT_CHECK"
  | "SAFETY_NOTICE"
  | "INSUFFICIENT_EVIDENCE";

export interface Claim {
  type: ClaimType;
  text: string;
  /** Evidence IDs this claim is grounded in. Required (non-empty) for FACT and SAFETY_NOTICE. */
  evidenceIds: string[];
  confidence?: ConfidenceLevel;
  riskLevel?: RiskLevel;
}

export class ClaimValidationError extends Error {
  constructor(message: string, readonly claim: Claim) {
    super(message);
    this.name = "ClaimValidationError";
  }
}

const EVIDENCE_REQUIRED: ReadonlySet<ClaimType> = new Set(["FACT", "SAFETY_NOTICE"]);

/**
 * Validates a batch of claims against the evidence actually available in
 * this response. Throws on the first violation rather than silently
 * dropping it -- callers (the LLM provider boundary included) must treat a
 * validation failure as "reject this output, fall back safely", never as
 * something to patch around.
 */
export function validateClaims(claims: Claim[], evidence: EvidenceIndex): void {
  for (const claim of claims) {
    for (const id of claim.evidenceIds) {
      if (!evidence.has(id)) {
        throw new ClaimValidationError(`Claim cites unknown evidence id "${id}"`, claim);
      }
    }
    if (EVIDENCE_REQUIRED.has(claim.type) && claim.evidenceIds.length === 0) {
      throw new ClaimValidationError(`${claim.type} claim must cite at least one evidence item`, claim);
    }
    if (claim.type === "FACT") {
      const hasRetrievedFact = claim.evidenceIds.some((id) => evidence.get(id)?.type === "knowledge_entry");
      if (!hasRetrievedFact) {
        throw new ClaimValidationError(
          "FACT claim must cite retrieved knowledge-entry evidence, not an inference",
          claim,
        );
      }
    }
  }
}

/** Filters out invalid claims instead of throwing -- used at the LLM provider boundary, where a
 * single bad claim should be dropped/fall back, not fail an entire structured response. */
export function filterValidClaims(claims: Claim[], evidence: EvidenceIndex): Claim[] {
  const valid: Claim[] = [];
  for (const claim of claims) {
    try {
      validateClaims([claim], evidence);
      valid.push(claim);
    } catch {
      // dropped: an invalid claim must never render, not even downgraded.
    }
  }
  return valid;
}
