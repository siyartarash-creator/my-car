"use server";
// Mobile Alpha integration -- server action boundary for the Teach MY CAR
// flow. The author/submitter identity always comes from the server-side
// authenticated session (requireRole), never from client-supplied state --
// this is the one place submitApprovedDraftToIntake is actually wired to a
// real Supabase client and a real profile id.
import { requireRole } from "@/lib/auth-server";
import type { ReviewableCaseDraft } from "@/lib/automotive/knowledge/reviewWorkflow";
import { submitApprovedDraftToIntake } from "@/lib/automotive/knowledge/submitApprovedDraft";

export async function submitTeachCase(reviewable: ReviewableCaseDraft): Promise<{ id: string }> {
  const { client, user } = await requireRole("admin");
  return submitApprovedDraftToIntake(client, reviewable, user.id);
}
