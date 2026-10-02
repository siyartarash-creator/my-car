// Track B -- Supabase-backed fetcher for published automotive knowledge.
// Read-only: the internal prototype never writes via this path. Depends on
// supabase/migrations/202610021000_automotive_foundation.sql being applied
// to the target environment; until then the query fails because the table
// doesn't exist, which callers must treat as "schema not ready", not a bug.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { KnowledgeEntry } from "./types";

interface KnowledgeEntryRow {
  id: number;
  source_id: number;
  system: string;
  subsystem: string | null;
  component: string | null;
  symptom: string;
  possible_cause: string;
  diagnostic_test: string | null;
  expected_result: string | null;
  repair_action: string | null;
  vehicle_applicability: Array<{ make?: string; model?: string; year_from?: number; year_to?: number }> | null;
  confidence: KnowledgeEntry["confidence"];
  risk_level: KnowledgeEntry["riskLevel"];
  review_status: KnowledgeEntry["reviewStatus"];
  is_fixture: boolean;
  automotive_knowledge_sources: { source_type: KnowledgeEntry["sourceType"] } | null;
}

export async function fetchPublishedKnowledge(client: SupabaseClient): Promise<KnowledgeEntry[]> {
  const { data, error } = await client
    .from("automotive_knowledge_entries")
    .select(
      "id,source_id,system,subsystem,component,symptom,possible_cause,diagnostic_test,expected_result,repair_action,vehicle_applicability,confidence,risk_level,review_status,is_fixture,automotive_knowledge_sources(source_type)",
    )
    .eq("review_status", "published")
    .eq("is_fixture", false);
  if (error) throw error;
  return ((data ?? []) as unknown as KnowledgeEntryRow[]).map((row) => ({
    id: String(row.id),
    sourceType: row.automotive_knowledge_sources?.source_type ?? "ai_inferred",
    system: row.system,
    subsystem: row.subsystem,
    component: row.component,
    symptom: row.symptom,
    possibleCause: row.possible_cause,
    diagnosticTest: row.diagnostic_test,
    expectedResult: row.expected_result,
    repairAction: row.repair_action,
    vehicleApplicability: (row.vehicle_applicability ?? []).map((v) => ({
      make: v.make,
      model: v.model,
      yearFrom: v.year_from,
      yearTo: v.year_to,
    })),
    confidence: row.confidence,
    riskLevel: row.risk_level,
    reviewStatus: row.review_status,
    isFixture: row.is_fixture,
  }));
}
