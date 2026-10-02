// Track B -- safety gating. This is the structural enforcement point: UI/
// prompt copy is not the safety boundary, this function is. Any caller that
// wants to show step-by-step action text must go through it.
import type { KnowledgeEntry } from "./types";

const RISK_ORDER = ["informational", "routine_safe", "requires_caution", "safety_critical"] as const;

export function riskRank(risk: KnowledgeEntry["riskLevel"]): number {
  return RISK_ORDER.indexOf(risk);
}

/**
 * Decides whether step-by-step action/repair text may be surfaced for an
 * entry, as opposed to explanation-only content.
 *
 * - informational / routine_safe: always explanation + action allowed.
 * - requires_caution: action text only with explicit caller authorization.
 * - safety_critical: action text never auto-generated here, regardless of
 *   authorization -- braking, airbags/SRS, fuel, high-current electrical,
 *   and structural/suspension work route to a qualified technician.
 */
export function canProvideActionGuidance(
  riskLevel: KnowledgeEntry["riskLevel"],
  allowActionGuidance: boolean | undefined,
): boolean {
  if (riskLevel === "safety_critical") return false;
  if (riskLevel === "requires_caution") return allowActionGuidance === true;
  return true;
}

export function safetyCriticalWarning(system: string): string {
  return `This involves a safety-critical system (${system}). Explanation only -- consult a qualified technician before taking any action.`;
}
