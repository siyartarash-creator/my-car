// Track B (parallel worker) -- structured draft contract for converting a
// real mechanic case (Mehdi's words) into a validated knowledge draft.
// See docs/automotive/knowledge/README.md for the full philosophy. This
// module defines data shapes only -- no DB access, no AI calls.
import type {
  ConfidenceLevel,
  KnowledgeSourceType,
  ReviewStatus,
  RiskLevel,
  VehicleContext,
} from "../types";

/**
 * Who/what produced this draft *record* -- distinct from `provenance`
 * (the underlying knowledge's source type once published). Keeping these
 * separate is what makes an AI-structured draft distinguishable from the
 * original mechanic-authored narration.
 */
export type DraftOrigin =
  | "mechanic_authored" // Mehdi's own words, transcribed/structured as-is, no AI involved
  | "ai_structured" // AI extracted/normalized fields from mechanic narration
  | "fixture"; // synthetic test-only data -- never eligible for publication

/**
 * Distinguishes "legitimately unknown" from "empty string" or a fabricated
 * default. Validation treats `{ known: false }` as acceptable and never
 * invents a value to fill it in.
 */
export type Maybe<T> = { known: true; value: T } | { known: false };

export const unknownField = <T>(): Maybe<T> => ({ known: false });
export const knownField = <T>(value: T): Maybe<T> => ({ known: true, value });

export interface CaseVehicleApplicability extends VehicleContext {
  engineVariant?: string;
}

export interface StructuredCaseDraft {
  id: string;
  /** Links back to the originating `automotive_case_intake` row, if any.
   * Omitted for drafts built purely for evaluation/testing. */
  sourceCaseId?: string | null;

  vehicle: {
    make: Maybe<string>;
    model: Maybe<string>;
    yearFrom: Maybe<number>;
    yearTo: Maybe<number>;
    engineVariant: Maybe<string>;
  };

  reportedSymptoms: string;
  mechanicObservations: Maybe<string>;
  diagnosticTestsPerformed: Maybe<string>;
  measuredResults: Maybe<string>;
  /** Causes actually considered, in the mechanic's own words/order. */
  candidateCauses: string[];
  /** Set only when the mechanic actually confirmed it. Must be one of
   * `candidateCauses` -- see validateCaseDraft. Never silently promoted
   * from a candidate by this system. */
  confirmedCause: Maybe<string>;
  repairActionPerformed: Maybe<string>;
  outcome: Maybe<string>;
  mechanicNotes: Maybe<string>;

  /** Who/what produced this draft record. */
  origin: DraftOrigin;
  /** Underlying knowledge provenance this draft would carry if published. */
  provenance: KnowledgeSourceType;
  confidence: ConfidenceLevel;
  riskLevel: RiskLevel;
  reviewStatus: ReviewStatus;
  /** Synthetic/test data. Fixtures can never reach reviewStatus "published"
   * -- see validateCaseDraft's publication-boundary rule. */
  isFixture: boolean;
  /** True iff an AI provider (STEP 5 boundary) proposed or transformed this
   * draft's fields. Must be false when origin is "mechanic_authored". */
  aiTransformed: boolean;

  reviewedByProfileId: Maybe<string>;
  reviewedAt: Maybe<string>;
}

export const ALLOWED_PROVENANCE: readonly KnowledgeSourceType[] = [
  "manufacturer",
  "trusted_technical_source",
  "mechanic_authored",
  "ai_inferred",
];

export const ALLOWED_CONFIDENCE: readonly ConfidenceLevel[] = ["low", "medium", "high"];

export const ALLOWED_RISK: readonly RiskLevel[] = [
  "informational",
  "routine_safe",
  "requires_caution",
  "safety_critical",
];

export const ALLOWED_REVIEW_STATUS: readonly ReviewStatus[] = ["draft", "reviewed", "published"];
