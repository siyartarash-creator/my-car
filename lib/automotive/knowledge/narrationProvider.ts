// Mobile Alpha Worker B -- provider-independent boundary for turning
// natural mechanic narration into a StructuredCaseDraft. No external AI
// call is made anywhere in this file ($0 external spend, no OCR/vision/RAG).
// A real provider (local or paid-and-authorized) can implement
// CaseDraftProvider later without changing callers. Whatever a provider
// proposes must still pass validateCaseDraft and remains
// reviewStatus: "draft" -- REVIEW REQUIRED, never auto-published.
//
// No mock/test implementation lives in this file -- a deterministic stand-in
// belongs in tests only (see tests/automotive/knowledge/testSupport/
// mockCaseDraftProvider.ts) so production code never ships a fake extractor.
import type { StructuredCaseDraft } from "./types";

export interface NaturalCaseInput {
  /** The mechanic's free-text narration, e.g. "Peugeot 206 cranked
   * normally but would not start. Scanner showed zero RPM while
   * cranking..." */
  rawNarration: string;
  /** Optional structured hints a human intake form may have already
   * captured separately from the free-text narration (e.g. vehicle fields
   * chosen from a dropdown). Never used to fabricate narration content
   * that wasn't actually said. */
  knownVehicle?: {
    make?: string;
    model?: string;
    yearFrom?: number;
    yearTo?: number;
  };
}

export interface CaseDraftProvider {
  /**
   * Proposes a StructuredCaseDraft from natural mechanic narration.
   * Implementations MUST:
   * - set origin: "ai_structured" and aiTransformed: true (never claim
   *   "mechanic_authored" origin for AI output)
   * - set reviewStatus: "draft" regardless of input confidence
   * - leave fields unknown (Maybe<T> with known: false) rather than
   *   inventing content the narration didn't actually contain
   * - never call a paid or external AI API from within this repository
   */
  proposeDraft(input: NaturalCaseInput): Promise<StructuredCaseDraft>;
}

/**
 * No real provider is wired up yet ($0 external spend -- no OCR/vision/RAG).
 * The Teach experience must degrade to manual structured entry when this is
 * the active "provider" -- it never fakes extraction.
 */
export const noProviderConfigured: CaseDraftProvider = {
  async proposeDraft(): Promise<StructuredCaseDraft> {
    throw new Error(
      "No narration-extraction provider is configured. Use manual structured entry instead of calling proposeDraft().",
    );
  },
};
