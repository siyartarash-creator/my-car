# Knowledge Draft Foundation (Track B parallel worker)

Status: internal foundation only. No real mechanic knowledge has been drafted or published through this path yet -- only fixtures exercise it (see [fixtures.ts](../../../lib/automotive/evaluation/fixtures.ts) for evaluation fixtures and `tests/automotive/knowledge/` for draft-contract fixtures). This extends, and does not replace, the Milestone 1 provenance/safety model in [../ARCHITECTURE.md](../ARCHITECTURE.md).

## Why a separate "draft" layer

`automotive_knowledge_entries` (Milestone 1) expresses *published* knowledge. Before a real case becomes one of those rows, it needs an intermediate, explicitly-unpublished representation that:

1. can hold a case while fields are still partially unknown,
2. keeps "who/what actually produced this text" distinguishable from "what kind of knowledge this will become," and
3. is validated the same way regardless of whether a human typed it or an AI structured it from narration.

`lib/automotive/knowledge/types.ts#StructuredCaseDraft` is that representation.

## Two provenance axes, not one

- **`origin`** (`mechanic_authored` | `ai_structured` | `fixture`): who/what produced *this draft record*.
- **`provenance`** (existing `KnowledgeSourceType`): what the underlying knowledge would be once published.

Keeping these separate is what makes "AI structured Mehdi's words" distinguishable from "Mehdi typed this himself," per the milestone brief's requirement that AI may structure but never silently invent mechanic facts.

## Unknown stays unknown

Every optional case field uses `Maybe<T>` (`{ known: true, value } | { known: false }`), never a fabricated default. `validateCaseDraft` never fills a value in on the draft's behalf -- it only rejects/accepts what's there.

## Validation vs. quality checks

- `draftContract.ts#validateCaseDraft` -- hard invariants (reject): allowed enum values, minimum content, fixture/real boundary, confirmed-cause support, publication/review gate.
- `qualityChecks.ts#checkDraftQuality` -- soft warnings a reviewer should see but that don't block the draft: repair without outcome, safety-keyword/risk mismatch, etc.

## Natural narration boundary

`narrationProvider.ts#CaseDraftProvider` is the seam a future AI provider implements to turn free text ("Peugeot 206 cranked normally but would not start...") into a `StructuredCaseDraft`. No external AI call exists in this repository; `TEST_ONLY_mockCaseDraftProvider` is a deterministic, clearly-marked stand-in for tests only, and its output is always `isFixture: true` -- which independently blocks it from ever reaching `reviewStatus: "published"`.

## Human review stays mandatory

Exactly as in Milestone 1: `reviewStatus: "published"` requires `reviewedByProfileId` and `reviewedAt` to both be known, and `isFixture` to be `false`. No code path in this worker's scope sets both of those automatically.
