// Track B (parallel worker) -- provider-independent boundary for turning
// natural mechanic narration into a StructuredCaseDraft. No external AI
// call is made anywhere in this file ($0 external spend). A real provider
// (local or paid-and-authorized) can implement CaseDraftProvider later
// without changing callers. Whatever a provider proposes must still pass
// validateCaseDraft and remains reviewStatus: "draft" -- REVIEW REQUIRED,
// never auto-published.
import { unknownField, type StructuredCaseDraft } from "./types";

export interface NaturalCaseInput {
  /** The mechanic's free-text narration, e.g. "Peugeot 206 cranked
   * normally but would not start. Scanner showed zero RPM while
   * cranking..." */
  rawNarration: string;
  /** Optional structured hints a human intake form may have already
   * captured separately from the free-text narration (e.g. vehicle fields
   * chosen from a dropdown). Never used to fabricate narration content
   * that wasn't actually said. */
  knownVehicle?: {
    make?: string;
    model?: string;
    yearFrom?: number;
    yearTo?: number;
  };
}

export interface CaseDraftProvider {
  /**
   * Proposes a StructuredCaseDraft from natural mechanic narration.
   * Implementations MUST:
   * - set origin: "ai_structured" and aiTransformed: true (never claim
   *   "mechanic_authored" origin for AI output)
   * - set reviewStatus: "draft" regardless of input confidence
   * - leave fields unknown (Maybe<T> with known: false) rather than
   *   inventing content the narration didn't actually contain
   * - never call a paid or external AI API from within this repository
   */
  proposeDraft(input: NaturalCaseInput): Promise<StructuredCaseDraft>;
}

/**
 * TEST-ONLY deterministic stand-in for a real provider. Does NOT call any
 * AI service -- it does simple keyword extraction so tests can exercise the
 * provider boundary without needing a real model. Always marks its output
 * isFixture: true, which independently blocks it from ever reaching
 * reviewStatus: "published" (see draftContract.ts). Do not use this to
 * generate anything presented as a real case.
 */
export const TEST_ONLY_mockCaseDraftProvider: CaseDraftProvider = {
  async proposeDraft(input: NaturalCaseInput): Promise<StructuredCaseDraft> {
    const text = input.rawNarration;
    const lower = text.toLowerCase();

    const candidateCauses: string[] = [];
    if (lower.includes("zero rpm") || lower.includes("no rpm")) {
      candidateCauses.push("crank position sensor signal not reaching the ECU");
    }
    if (lower.includes("crank sensor") || lower.includes("crank position sensor")) {
      candidateCauses.push("crank position sensor fault or wiring issue");
    }

    return {
      id: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sourceCaseId: null,
      vehicle: {
        make: input.knownVehicle?.make ? { known: true, value: input.knownVehicle.make } : unknownField(),
        model: input.knownVehicle?.model ? { known: true, value: input.knownVehicle.model } : unknownField(),
        yearFrom: input.knownVehicle?.yearFrom != null ? { known: true, value: input.knownVehicle.yearFrom } : unknownField(),
        yearTo: input.knownVehicle?.yearTo != null ? { known: true, value: input.knownVehicle.yearTo } : unknownField(),
        engineVariant: unknownField(),
      },
      reportedSymptoms: text,
      mechanicObservations: unknownField(),
      diagnosticTestsPerformed: lower.includes("scanner") ? { known: true, value: "scan tool check during cranking" } : unknownField(),
      measuredResults: unknownField(),
      candidateCauses,
      confirmedCause: unknownField(),
      repairActionPerformed: unknownField(),
      outcome: unknownField(),
      mechanicNotes: unknownField(),
      origin: "ai_structured",
      provenance: "mechanic_authored",
      confidence: "low",
      riskLevel: "informational",
      reviewStatus: "draft",
      isFixture: true,
      aiTransformed: true,
      reviewedByProfileId: unknownField(),
      reviewedAt: unknownField(),
    };
  },
};
