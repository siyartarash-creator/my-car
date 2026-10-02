// Mobile Alpha integration -- the one place a validated CaseIntakeDraft is
// actually inserted into automotive_case_intake. Reuses the existing table
// and RLS (case_intake_write: author_profile_id = auth.uid()) unchanged --
// no migration, no new policy. Always inserts status "draft" implicitly
// (the table's own default); reviewed/published remain separate human/admin
// actions, exactly as in the existing Mehdi intake pipeline.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CaseIntakeDraft } from "../caseIntake";

export async function insertCaseIntakeDraft(
  client: SupabaseClient,
  draft: CaseIntakeDraft,
): Promise<{ id: string }> {
  const { data, error } = await client
    .from("automotive_case_intake")
    .insert({
      author_profile_id: draft.authorProfileId,
      vehicle_applicability: draft.vehicleApplicability,
      observed: draft.observed,
      diagnosis: draft.diagnosis,
      diagnostic_test: draft.diagnosticTest,
      resolution: draft.resolution,
      uncertainty_notes: draft.uncertaintyNotes,
      safety_notes: draft.safetyNotes,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: String(data.id) };
}
