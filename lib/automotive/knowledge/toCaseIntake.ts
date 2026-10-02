// Track B Milestone 2 integration -- adapter from the structured-draft
// authoring layer (this directory) to Core's real-case intake validation
// (lib/automotive/caseIntake.ts). This is intentionally the ONLY place a
// StructuredCaseDraft is turned into a CaseIntakeDraftInput: Core's
// parseCaseIntakeDraft() remains the single source of truth for what is
// actually allowed to become an automotive_case_intake row, including the
// `confirmedRealCase: true` gate, which this adapter never sets on the
// draft's behalf -- it must be supplied explicitly by whoever is confirming
// the case, exactly like calling parseCaseIntakeDraft() directly.
import type { CaseIntakeDraftInput } from "../caseIntake";
import type { StructuredCaseDraft } from "./types";

export class DraftNotReadyForIntakeError extends Error {}

export interface IntakeConfirmation {
  /** Must be explicitly true -- never inferred from the draft. */
  confirmedRealCase: true;
  authorProfileId: string;
}

/**
 * Maps a StructuredCaseDraft to Core's CaseIntakeDraftInput shape. Throws
 * DraftNotReadyForIntakeError (never fabricates a value) when the draft is
 * a fixture, or is still missing the repair/outcome a real case intake
 * requires -- a draft that hasn't reached a confirmed resolution yet is not
 * ready to leave this authoring layer.
 */
export function draftToCaseIntakeInput(
  draft: StructuredCaseDraft,
  confirmation: IntakeConfirmation,
): CaseIntakeDraftInput {
  if (draft.isFixture) {
    throw new DraftNotReadyForIntakeError("fixture drafts can never become case intake input");
  }
  if (!draft.repairActionPerformed.known || !draft.outcome.known) {
    throw new DraftNotReadyForIntakeError(
      "draft is missing a confirmed repair action or outcome -- not ready for intake",
    );
  }

  const diagnosisParts = [...draft.candidateCauses];
  if (draft.confirmedCause.known) diagnosisParts.push(`Confirmed: ${draft.confirmedCause.value}`);

  const vehicleApplicability = draft.vehicle.make.known || draft.vehicle.model.known
    ? [
        {
          ...(draft.vehicle.make.known ? { make: draft.vehicle.make.value } : {}),
          ...(draft.vehicle.model.known ? { model: draft.vehicle.model.value } : {}),
          ...(draft.vehicle.yearFrom.known ? { yearFrom: draft.vehicle.yearFrom.value } : {}),
          ...(draft.vehicle.yearTo.known ? { yearTo: draft.vehicle.yearTo.value } : {}),
        },
      ]
    : [];

  const safetyNotes =
    draft.riskLevel === "requires_caution" || draft.riskLevel === "safety_critical"
      ? `riskLevel: ${draft.riskLevel}`
      : undefined;

  return {
    confirmedRealCase: confirmation.confirmedRealCase,
    authorProfileId: confirmation.authorProfileId,
    vehicleApplicability,
    observed: [draft.reportedSymptoms, draft.mechanicObservations.known ? draft.mechanicObservations.value : null]
      .filter((s): s is string => Boolean(s))
      .join(" -- "),
    diagnosis: diagnosisParts.length > 0 ? diagnosisParts.join("; ") : "unspecified",
    diagnosticTest: draft.diagnosticTestsPerformed.known ? draft.diagnosticTestsPerformed.value : undefined,
    resolution: `${draft.repairActionPerformed.value} -- outcome: ${draft.outcome.value}`,
    uncertaintyNotes: draft.mechanicNotes.known ? draft.mechanicNotes.value : undefined,
    safetyNotes,
  };
}
