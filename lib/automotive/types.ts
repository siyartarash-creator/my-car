// Track B -- Automotive Intelligence domain types.
// Mirrors supabase/migrations/202610021000_automotive_foundation.sql.
// Keep in sync with that file.
import type { EvidenceItem, ObservationInput } from "./evidence";
import type { Claim } from "./claims";

export type KnowledgeSourceType =
  | "manufacturer"
  | "trusted_technical_source"
  | "mechanic_authored"
  | "ai_inferred";

export type ConfidenceLevel = "low" | "medium" | "high";

export type RiskLevel =
  | "informational"
  | "routine_safe"
  | "requires_caution"
  | "safety_critical";

export type ReviewStatus = "draft" | "reviewed" | "published";

export interface VehicleContext {
  make?: string;
  model?: string;
  yearFrom?: number;
  yearTo?: number;
}

export interface KnowledgeEntry {
  id: string;
  sourceType: KnowledgeSourceType;
  system: string;
  subsystem?: string | null;
  component?: string | null;
  symptom: string;
  possibleCause: string;
  diagnosticTest?: string | null;
  expectedResult?: string | null;
  repairAction?: string | null;
  /** Empty/absent means the entry applies broadly (not vehicle-specific). */
  vehicleApplicability?: VehicleContext[];
  confidence: ConfidenceLevel;
  riskLevel: RiskLevel;
  reviewStatus: ReviewStatus;
  isFixture: boolean;
}

export interface DiagnosticQuery {
  question: string;
  vehicle?: VehicleContext;
  /** Explicit, user-requested authorization to receive step-by-step action
   * text for requires_caution entries. Never implied by asking a question. */
  allowActionGuidance?: boolean;
  /** Observations/test results supplied for this diagnosis turn (progressive
   * diagnosis) -- never fabricated by the system, always caller-supplied. */
  observations?: ObservationInput[];
}

export interface CitedFinding {
  entryId: string;
  sourceType: KnowledgeSourceType;
  confidence: ConfidenceLevel;
  riskLevel: RiskLevel;
  system: string;
  symptom: string;
  possibleCause: string;
  nextDiagnosticStep: string | null;
  /** Populated only when canProvideActionGuidance() allows it for this
   * finding and query -- never a substitute for the risk gate. */
  actionGuidance: string | null;
}

export type DiagnosticStatus =
  | "grounded"
  | "clarification_needed"
  | "insufficient_data";

export interface DiagnosticResponse {
  status: DiagnosticStatus;
  findings: CitedFinding[];
  clarifyingQuestions: string[];
  notes: string[];
  /** Every evidence item (retrieved knowledge entries + supplied observations)
   * available for claims in this response to cite. */
  evidence: EvidenceItem[];
  /** Structured, evidence-traced claims -- see lib/automotive/claims.ts.
   * Every claim here has already passed validateClaims() against `evidence`. */
  claims: Claim[];
}
