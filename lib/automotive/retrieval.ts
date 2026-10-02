// Track B -- structured/filterable retrieval (no vector search / embeddings
// in V1; see docs/automotive/ARCHITECTURE.md for the trigger criteria for
// adding one later).
import type { DiagnosticQuery, KnowledgeEntry, VehicleContext } from "./types";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9؀-ۿ]+/)
    .filter((t) => t.length > 1);
}

function vehicleApplies(entryApplicability: VehicleContext[] | undefined, queryVehicle: VehicleContext | undefined): boolean {
  if (!entryApplicability || entryApplicability.length === 0) return true; // applies broadly
  if (!queryVehicle) return true; // no vehicle context given: don't over-filter
  return entryApplicability.some((app) => {
    if (app.make && queryVehicle.make && app.make.toLowerCase() !== queryVehicle.make.toLowerCase()) return false;
    if (app.model && queryVehicle.model && app.model.toLowerCase() !== queryVehicle.model.toLowerCase()) return false;
    if (queryVehicle.yearFrom != null) {
      if (app.yearTo != null && queryVehicle.yearFrom > app.yearTo) return false;
      if (app.yearFrom != null && queryVehicle.yearFrom < app.yearFrom) return false;
    }
    return true;
  });
}

function matchesQuery(entry: KnowledgeEntry, terms: string[]): boolean {
  const haystack = [entry.system, entry.subsystem, entry.component, entry.symptom, entry.possibleCause]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return terms.some((t) => haystack.includes(t));
}

const CONFIDENCE_RANK: Record<KnowledgeEntry["confidence"], number> = { high: 2, medium: 1, low: 0 };

export interface RetrievalOptions {
  /** Allow fixture-marked entries to be retrieved. Only ever true in tests. */
  includeFixtures?: boolean;
}

/**
 * Filters to published, non-fixture knowledge (unless includeFixtures is
 * set), applies vehicle-applicability and keyword matching, and ranks by
 * confidence. Never returns unpublished or ai_inferred-unreviewed content.
 */
export function retrieveKnowledge(
  entries: KnowledgeEntry[],
  query: DiagnosticQuery,
  options: RetrievalOptions = {},
): KnowledgeEntry[] {
  const eligible = entries.filter(
    (e) => e.reviewStatus === "published" && (options.includeFixtures || !e.isFixture),
  );
  const vehicleFiltered = eligible.filter((e) => vehicleApplies(e.vehicleApplicability, query.vehicle));
  const terms = tokenize(query.question);
  const matched = terms.length === 0 ? vehicleFiltered : vehicleFiltered.filter((e) => matchesQuery(e, terms));
  return matched.sort((a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence]);
}
