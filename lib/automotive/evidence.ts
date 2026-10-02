// Track B Milestone 2 -- evidence model. The smallest representation needed
// to let a diagnostic claim be structurally traced to what actually backs
// it, instead of free text that receives citations after the fact (the
// DiagForge-influenced pattern noted in the milestone brief; no DiagForge
// code was copied).
//
// This is TypeScript-only: it does not introduce new tables. Knowledge-entry
// evidence is derived from automotive_knowledge_entries (already a table).
// Observation/measurement evidence is derived from caller input (a session's
// progressive diagnosis turn) or, once reviewed, an automotive_case_intake
// row -- neither needs its own table to exist as an EvidenceItem in-memory.
import type { ConfidenceLevel, KnowledgeEntry, RiskLevel } from "./types";

export type EvidenceType =
  | "knowledge_entry"
  | "mechanic_observation"
  | "user_observation"
  | "measured_value"
  | "diagnostic_test_result";

export interface EvidenceItem {
  id: string;
  type: EvidenceType;
  /** Human-readable source/reference, e.g. "knowledge entry 12" or "user-reported observation". */
  source: string;
  /** The fact/content this evidence item actually asserts. */
  content: string;
  /** Provenance category it traces back to -- absent for raw user input, which has no provenance claim. */
  provenance?: KnowledgeEntry["sourceType"];
  confidence?: ConfidenceLevel;
  riskContext?: RiskLevel;
}

/** An observation/measurement supplied by the caller for a diagnosis turn -- never fabricated by the system. */
export interface ObservationInput {
  type: "mechanic_observation" | "user_observation" | "measured_value" | "diagnostic_test_result";
  content: string;
  /** When this observation confirms or rules out a specific knowledge entry's diagnostic test. */
  relatedToEntryId?: string;
  result?: "confirmed" | "ruled_out";
}

export function evidenceFromKnowledgeEntry(entry: KnowledgeEntry): EvidenceItem {
  return {
    id: `evidence:entry:${entry.id}`,
    type: "knowledge_entry",
    source: `knowledge entry ${entry.id} (${entry.sourceType})`,
    content: `${entry.symptom} -> ${entry.possibleCause}`,
    provenance: entry.sourceType,
    confidence: entry.confidence,
    riskContext: entry.riskLevel,
  };
}

export function evidenceFromObservation(observation: ObservationInput, index: number): EvidenceItem {
  return {
    id: `evidence:observation:${index}`,
    type: observation.type,
    source: observation.relatedToEntryId ? `observation re: entry ${observation.relatedToEntryId}` : "observation",
    content: observation.content,
  };
}

/** A lookup for validating that claims only cite evidence that actually exists in this response. */
export class EvidenceIndex {
  private readonly byId = new Map<string, EvidenceItem>();

  constructor(items: EvidenceItem[]) {
    for (const item of items) this.byId.set(item.id, item);
  }

  get(id: string): EvidenceItem | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  all(): EvidenceItem[] {
    return [...this.byId.values()];
  }
}
