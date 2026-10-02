// Track B Milestone 2 -- Mehdi knowledge intake pipeline. Validates a real
// case description against the automotive_case_intake shape before it is
// ever inserted, so a malformed or accidentally-fabricated draft fails here
// instead of reaching the DB. This module performs validation only -- it
// does not call Supabase and does not publish anything; human review
// (draft -> reviewed -> published) remains a separate, DB-enforced step
// (see published_case_has_entry in the migration).
//
// CRITICAL: `confirmedRealCase: true` must be set explicitly by whoever is
// submitting. There is no default and no inference -- this exists so an
// AI-assisted drafting step can never silently mark its own example as a
// real mechanic case.
import type { VehicleContext } from "./types";

export interface CaseIntakeDraftInput {
  confirmedRealCase: true;
  authorProfileId: string;
  vehicleApplicability?: VehicleContext[];
  observed: string;
  diagnosis: string;
  diagnosticTest?: string;
  resolution: string;
  uncertaintyNotes?: string;
  safetyNotes?: string;
}

export interface CaseIntakeDraft {
  authorProfileId: string;
  vehicleApplicability: VehicleContext[];
  observed: string;
  diagnosis: string;
  diagnosticTest: string | null;
  resolution: string;
  uncertaintyNotes: string | null;
  safetyNotes: string | null;
  status: "draft";
}

export class CaseIntakeValidationError extends Error {}

function boundedString(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw new CaseIntakeValidationError(`${field} must be a string between ${min} and ${max} characters`);
  }
  return value;
}

/**
 * Validates a submitted case against the real-case intake contract. Throws
 * CaseIntakeValidationError on anything malformed, under-specified, or not
 * explicitly confirmed as a real case. Returns a draft shape ready to
 * become an automotive_case_intake row with status "draft" -- never
 * "reviewed" or "published", which remain human actions.
 */
export function parseCaseIntakeDraft(input: CaseIntakeDraftInput): CaseIntakeDraft {
  if (input.confirmedRealCase !== true) {
    throw new CaseIntakeValidationError(
      "confirmedRealCase must be explicitly true -- this tooling never submits an assumed or example case",
    );
  }
  if (typeof input.authorProfileId !== "string" || input.authorProfileId.length === 0) {
    throw new CaseIntakeValidationError("authorProfileId is required");
  }

  const observed = boundedString(input.observed, "observed", 1, 2000);
  const diagnosis = boundedString(input.diagnosis, "diagnosis", 1, 2000);
  const resolution = boundedString(input.resolution, "resolution", 1, 2000);

  const vehicleApplicability = input.vehicleApplicability ?? [];
  if (!Array.isArray(vehicleApplicability)) {
    throw new CaseIntakeValidationError("vehicleApplicability must be an array");
  }

  return {
    authorProfileId: input.authorProfileId,
    vehicleApplicability,
    observed,
    diagnosis,
    diagnosticTest: input.diagnosticTest ?? null,
    resolution,
    uncertaintyNotes: input.uncertaintyNotes ?? null,
    safetyNotes: input.safetyNotes ?? null,
    status: "draft",
  };
}
