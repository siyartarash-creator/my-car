// Mobile Alpha integration -- the full approved-draft pipeline: explicit
// approval (already done by the caller via reviewWorkflow.ts#approveDraft)
// -> ready-for-intake extraction -> adapter to Core's intake shape -> Core's
// own parseCaseIntakeDraft() validation (unchanged, untouched) ->
// persistence through the existing automotive_case_intake table/RLS. This
// is the only place these four steps are chained; nothing here weakens or
// bypasses parseCaseIntakeDraft's confirmedRealCase gate -- it is always
// true here because this function only ever runs after an explicit,
// recorded human approval (see ReviewableCaseDraft#state === "approved").
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCaseIntakeDraft } from "../caseIntake";
import { insertCaseIntakeDraft } from "./persistCaseIntake";
import { toReadyForIntakeResult, type ReviewableCaseDraft } from "./reviewWorkflow";
import { draftToCaseIntakeInput } from "./toCaseIntake";

export async function submitApprovedDraftToIntake(
  client: SupabaseClient,
  reviewable: ReviewableCaseDraft,
  authorProfileId: string,
): Promise<{ id: string }> {
  const draft = toReadyForIntakeResult(reviewable); // throws unless state === "approved"
  const intakeInput = draftToCaseIntakeInput(draft, { confirmedRealCase: true, authorProfileId });
  const parsed = parseCaseIntakeDraft(intakeInput); // Core's own validation, unchanged
  return insertCaseIntakeDraft(client, parsed);
}
