// Track B (parallel worker) -- evaluation scenario contract for Automotive
// AI diagnostic behavior. Scenarios are TEST FIXTURES: evaluation truth/test
// metadata is kept separate from production knowledge and is never
// mechanic-authored knowledge. See docs/automotive/evaluation/README.md.
import type { VehicleContext } from "../types";

export interface EvaluationEvidenceItem {
  id: string;
  description: string;
}

export type SafetyExpectation = "none" | "caution_warning" | "safety_critical_warning";
export type UncertaintyExpectation = "must_express_uncertainty" | "may_be_confident";

export interface EvaluationScenario {
  id: string;
  vehicleContext: VehicleContext;
  initialComplaint: string;
  availableEvidence: EvaluationEvidenceItem[];
  /** Hidden diagnostic truth for test purposes only -- never shown to the
   * system under test, only used by the evaluator. */
  expectedTruth: {
    rootCause: string;
    supportingEvidenceIds: string[];
  };
  acceptableClarifyingQuestions: string[];
  acceptableNextChecks: string[];
  /** Claims the assistant must NOT make for this scenario (substring match,
   * case-insensitive) -- used to detect fabricated/unsupported conclusions. */
  unacceptableClaims: string[];
  expectedSafetyBehavior: SafetyExpectation;
  expectedUncertaintyBehavior: UncertaintyExpectation;
  /** When set, output produced for a vehicle outside this context should be
   * rejected/flagged by the applicability check. */
  applicability?: VehicleContext;
  /** Always true -- scenarios are evaluation fixtures, never mechanic-
   * authored knowledge. Enforced by assertFixtureScenario. */
  isFixture: true;
}

export interface EvaluatedClaim {
  text: string;
  /** Evidence item ids (must reference `availableEvidence`) the claim
   * cites. Empty means unsupported. */
  evidenceIds: string[];
  /** true = presented as established fact; false = presented as a
   * hypothesis/possibility. */
  presentedAsFact: boolean;
}

/** The shape of a candidate diagnostic output under evaluation -- provider-
 * agnostic, produced by whatever assistant/provider is being measured. */
export interface CandidateDiagnosticOutput {
  claims: EvaluatedClaim[];
  clarifyingQuestions: string[];
  nextChecks: string[];
  uncertaintyAcknowledged: boolean;
  safetyWarningGiven: boolean;
  vehicleContextUsed?: VehicleContext;
}

export function assertFixtureScenario(scenario: EvaluationScenario): void {
  if (scenario.isFixture !== true) {
    throw new Error(`evaluation scenario ${scenario.id} must have isFixture: true`);
  }
}
