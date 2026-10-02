// TEST-ONLY deterministic stand-in for a real CaseDraftProvider. Does NOT
// call any AI/OCR/vision service -- it does simple keyword extraction so
// tests can exercise the narration-provider boundary without a real model.
// Always marks its output isFixture: true, which independently blocks it
// from ever reaching reviewStatus: "published" (see draftContract.ts). This
// file must never be imported from lib/ or app/ -- it exists only so tests
// have something to call through CaseDraftProvider.
import { unknownField, type StructuredCaseDraft } from "../../../../lib/automotive/knowledge/types";
import type { CaseDraftProvider, NaturalCaseInput } from "../../../../lib/automotive/knowledge/narrationProvider";

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
