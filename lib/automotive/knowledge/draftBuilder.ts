// Mobile Alpha Worker B -- factory for a blank, manually-authored
// StructuredCaseDraft. Every optional field starts unknown -- nothing is
// pre-filled or guessed. This is the starting point for manual structured
// entry (no narration provider involved) and the merge target when a
// proposed draft comes back from a CaseDraftProvider.
import { unknownField, type StructuredCaseDraft } from "./types";

export interface NewDraftContext {
  id: string;
  authorNote?: string;
}

/** A blank draft ready for manual editing in the Teach UI. */
export function createEmptyDraft(context: NewDraftContext): StructuredCaseDraft {
  return {
    id: context.id,
    sourceCaseId: null,
    vehicle: {
      make: unknownField(),
      model: unknownField(),
      yearFrom: unknownField(),
      yearTo: unknownField(),
      engineVariant: unknownField(),
    },
    reportedSymptoms: "",
    mechanicObservations: unknownField(),
    diagnosticTestsPerformed: unknownField(),
    measuredResults: unknownField(),
    candidateCauses: [],
    confirmedCause: unknownField(),
    repairActionPerformed: unknownField(),
    outcome: unknownField(),
    mechanicNotes: context.authorNote ? { known: true, value: context.authorNote } : unknownField(),
    origin: "mechanic_authored",
    provenance: "mechanic_authored",
    confidence: "low",
    riskLevel: "informational",
    reviewStatus: "draft",
    isFixture: false,
    aiTransformed: false,
    reviewedByProfileId: unknownField(),
    reviewedAt: unknownField(),
  };
}

/**
 * Merges an AI-proposed draft into a fresh editable copy with a new id.
 * Deliberately a shallow passthrough of the proposal's own fields (origin
 * stays whatever the provider set, normally "ai_structured") -- this never
 * relabels AI-structured content as mechanic-authored; only an explicit
 * human edit (see reviewWorkflow.ts#editDraft) changes provenance fields,
 * and only approveDraft's human sign-off can move it forward, never this.
 */
export function fromProposedDraft(proposal: StructuredCaseDraft, context: { id: string }): StructuredCaseDraft {
  return { ...proposal, id: context.id };
}
