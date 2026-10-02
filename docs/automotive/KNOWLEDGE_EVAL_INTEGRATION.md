# Track B Knowledge & Evaluation -- Integration Contract

Produced by the parallel Knowledge & Evaluation worker on `track-b-knowledge-eval`, starting from the Milestone 1 checkpoint (`6e86867`). This document is for the PM/Owner to reconcile against Milestone 2 Core (`track-b-automotive-foundation`) after both workers finish. **No cross-branch integration has been performed by this worker** -- this is a map for whoever does it.

## What this worker added

New, isolated files only -- nothing in the Milestone 1 surface was modified:

```
lib/automotive/knowledge/
  types.ts            -- StructuredCaseDraft, Maybe<T>, DraftOrigin, allowed-value lists
  draftContract.ts     -- validateCaseDraft (hard invariants)
  qualityChecks.ts      -- checkDraftQuality (soft warnings)
  narrationProvider.ts  -- CaseDraftProvider interface + TEST_ONLY mock

lib/automotive/evaluation/
  types.ts        -- EvaluationScenario, CandidateDiagnosticOutput, assertFixtureScenario
  evaluator.ts     -- evaluateScenario (deterministic checks)
  runner.ts         -- runEvaluationSuite (batch runner)
  fixtures.ts       -- EVALUATION_SCENARIOS (10 synthetic scenarios)

tests/automotive/knowledge/draft-contract.test.mjs
tests/automotive/evaluation/evaluator.test.mjs

docs/automotive/knowledge/README.md
docs/automotive/evaluation/README.md
docs/automotive/KNOWLEDGE_EVAL_INTEGRATION.md  (this file)
```

## Exports Core can consume

| Export | Signature | Purpose |
|---|---|---|
| `knowledge/draftContract.ts` | `validateCaseDraft(draft: StructuredCaseDraft): { valid: boolean; errors: string[] }` | Validate a draft before it is shown to a reviewer or persisted. |
| `knowledge/qualityChecks.ts` | `checkDraftQuality(draft: StructuredCaseDraft): QualityWarning[]` | Non-blocking warnings to surface in a review UI. |
| `knowledge/narrationProvider.ts` | `interface CaseDraftProvider { proposeDraft(input): Promise<StructuredCaseDraft> }` | Boundary Core's future ingestion UI/route can call once a real provider exists. |
| `evaluation/evaluator.ts` | `evaluateScenario(scenario, output): EvaluationResult` | Check one candidate diagnostic output against one scenario. |
| `evaluation/runner.ts` | `runEvaluationSuite(scenarios, outputsByScenarioId): EvaluationSuiteSummary` | Batch-run evaluation, e.g. in a future CI/regression script for `runDiagnosticQuery` + a narration provider. |
| `evaluation/fixtures.ts` | `EVALUATION_SCENARIOS: EvaluationScenario[]` | 10 ready-made scenarios Core's own tests can reuse directly. |

## Expected data shapes

`StructuredCaseDraft` deliberately mirrors the Milestone 1 `KnowledgeEntry`/`automotive_case_intake` vocabulary (`sourceType` → `provenance`, `confidence`, `riskLevel`, `reviewStatus`) so that promoting a validated, reviewed draft into a real `automotive_knowledge_entries` row (once the pending migration is reconciled and applied) should be a field-mapping exercise, not a redesign. The one new concept Core doesn't have yet is `origin` (`mechanic_authored` / `ai_structured` / `fixture`) -- see [docs/automotive/knowledge/README.md](knowledge/README.md#two-provenance-axes-not-one) for why it's kept separate from `provenance`.

`EvaluationScenario`/`CandidateDiagnosticOutput` are intentionally decoupled from `DiagnosticResponse`/`CitedFinding` (Milestone 1's actual contract types) -- no adapter between them exists yet. See below.

## Validation / evaluation entry points

- Before persisting or showing a draft to a reviewer: call `validateCaseDraft`, then `checkDraftQuality` for a review UI.
- To regression-test a narration provider or the diagnostic contract's output quality: build a `CandidateDiagnosticOutput` from its response and run it through `evaluateScenario` / `runEvaluationSuite` against `EVALUATION_SCENARIOS`.

## Potential conflicts

None expected. This worker did not touch `lib/automotive/types.ts`, `safety.ts`, `retrieval.ts`, `diagnosticContract.ts`, `llmProvider.ts`, `supabaseKnowledgeSource.ts`, `app/automotive/*`, `supabase/automotive-pending/*`, `tests/automotive/diagnostic-contract.test.mjs`, `tests/automotive/schema-security.mjs`, `tests/automotive/fixtures.mjs`, or either existing `docs/automotive/*.md` file. `npm run test:automotive` (the existing Milestone 1 suite) was re-run at closure and still passes unmodified.

## Shared-file changes intentionally avoided

None were required. No change to `package.json`/`package-lock.json`, migrations, RLS, or any file outside the new paths listed above was needed to implement this scope.

## Recommended later integration order

1. Core finishes Milestone 2 and its own contract/types stabilize.
2. PM/Owner decides whether `StructuredCaseDraft` becomes the real intake-review representation, or whether `automotive_case_intake` gains columns directly -- this worker intentionally did not make that schema decision.
3. Write a thin adapter from `DiagnosticResponse`/`CitedFinding` (Core) to `CandidateDiagnosticOutput` (this worker) so `EVALUATION_SCENARIOS` can actually be run against the real diagnostic contract + narration provider, not just hand-built test outputs.
4. Wire a real `CaseDraftProvider` implementation (local or paid-and-authorized LLM) behind `narrationProvider.ts`'s interface once one is authorized; `TEST_ONLY_mockCaseDraftProvider` must not be used outside tests.
5. Only after the above: reconcile `origin`/`isFixture` semantics with however Core's migration ends up modeling `automotive_case_intake`, and apply the pending migration.

## PM integration notes

- This worker's types are additive and were designed not to require changes to Milestone 1 files, but they were **not** type-checked against Core's Milestone 2 changes (which didn't exist yet when this worker started) -- re-run `npm run typecheck` after merging both branches.
- `origin: "fixture"` vs `isFixture: true` have a one-directional relationship (`origin === "fixture"` implies `isFixture`, not the reverse) specifically so a test-only AI-structuring exercise (`origin: "ai_structured"`, `isFixture: true`) remains possible without being misread as literal fixture data. Confirm this reads clearly to whoever does the schema reconciliation in step 2 above.
- The evaluation scenario count (10) and knowledge test count are intentionally small per the milestone brief's "smallest high-quality foundation" instruction -- expanding either set is a deliberate follow-up decision, not an oversight.
