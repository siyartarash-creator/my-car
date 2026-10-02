"use server";
// Track B -- server action for the internal, read-only diagnostic prototype.
// No privileged writes, no autonomous vehicle actions: this only reads
// published knowledge and runs the deterministic contract over it.
import { requireRole } from "@/lib/auth-server";
import { runDiagnosticQuery } from "@/lib/automotive/diagnosticContract";
import { mockNarrationProvider } from "@/lib/automotive/llmProvider";
import { fetchPublishedKnowledge } from "@/lib/automotive/supabaseKnowledgeSource";
import type { Claim } from "@/lib/automotive/claims";
import type { EvidenceItem } from "@/lib/automotive/evidence";
import type { DiagnosticQuery } from "@/lib/automotive/types";

export interface AssistantResult {
  narrative: string;
  status: string;
  schemaReady: boolean;
  evidence: EvidenceItem[];
  claims: Claim[];
  clarifyingQuestions: string[];
}

export async function askAssistant(question: string, allowActionGuidance: boolean): Promise<AssistantResult> {
  const { client } = await requireRole("admin");
  const query: DiagnosticQuery = { question, allowActionGuidance };

  try {
    const entries = await fetchPublishedKnowledge(client);
    const response = runDiagnosticQuery(entries, query);
    const narrative = await mockNarrationProvider.narrate(response, query);
    return {
      narrative,
      status: response.status,
      schemaReady: true,
      evidence: response.evidence,
      claims: response.claims,
      clarifyingQuestions: response.clarifyingQuestions,
    };
  } catch {
    return {
      narrative: "Automotive knowledge schema is not yet applied or not reachable. No live data to query.",
      status: "schema_not_ready",
      schemaReady: false,
      evidence: [],
      claims: [],
      clarifyingQuestions: [],
    };
  }
}
