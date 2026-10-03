"use server";
// Mobile Alpha integration -- server action boundary for the Teach MY CAR
// flow. The author/submitter identity always comes from the server-side
// authenticated session (requireRole), never from client-supplied state --
// this is the one place submitApprovedDraftToIntake is actually wired to a
// real Supabase client and a real profile id.
//
// submitApprovedDraftToIntake's lib-level contract is to throw (see its own
// tests) -- but an error thrown across a Server Action boundary is exactly
// what Next.js redacts into the generic, undebuggable "Minified React error
// #441" in a production build. The known, user-correctable failures (draft
// not approved/ready, Core validation) are caught here and returned as a
// normal value instead, so the real Persian message reaches the UI; this is
// the only place that distinction matters, so it stays here rather than
// changing the lib layer's throwing contract.
import { requireRole } from "@/lib/auth-server";
import { CaseIntakeValidationError } from "@/lib/automotive/caseIntake";
import type { ReviewableCaseDraft } from "@/lib/automotive/knowledge/reviewWorkflow";
import { ReviewWorkflowError } from "@/lib/automotive/knowledge/reviewWorkflow";
import { submitApprovedDraftToIntake } from "@/lib/automotive/knowledge/submitApprovedDraft";
import { DraftNotReadyForIntakeError } from "@/lib/automotive/knowledge/toCaseIntake";

export type SubmitTeachCaseResult = { id: string } | { error: string };

export async function submitTeachCase(reviewable: ReviewableCaseDraft): Promise<SubmitTeachCaseResult> {
  const { client, user } = await requireRole("admin");
  try {
    return await submitApprovedDraftToIntake(client, reviewable, user.id);
  } catch (err) {
    if (
      err instanceof ReviewWorkflowError ||
      err instanceof DraftNotReadyForIntakeError ||
      err instanceof CaseIntakeValidationError
    ) {
      return { error: err.message };
    }
    console.error("submitTeachCase: unexpected failure", err);
    return { error: "ثبت نهایی با خطای غیرمنتظره مواجه شد. لطفاً دوباره تلاش کنید." };
  }
}
