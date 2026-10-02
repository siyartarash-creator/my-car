# Evaluation Foundation (Track B parallel worker)

Status: internal, deterministic-only foundation. No LLM-as-judge, no paid AI, no benchmark platform -- see [../ARCHITECTURE.md](../ARCHITECTURE.md) for the Milestone 1 contract this is meant to eventually evaluate.

## What this measures

A small, reusable contract for checking whether a candidate diagnostic output (from any provider -- the deterministic contract, a future LLM narrator, or a human-written stub in a test) behaves correctly against a known scenario:

- cites only real evidence (no fabricated evidence IDs)
- doesn't present unsupported claims as fact
- expresses uncertainty when evidence is insufficient
- gives the expected safety warning when the scenario calls for one
- respects vehicle applicability
- proposes next checks from the acceptable set, when any are defined

## Scenarios are fixtures, not knowledge

`lib/automotive/evaluation/types.ts#EvaluationScenario` always carries `isFixture: true` (enforced structurally in the type, and checked by `assertFixtureScenario`). A scenario's `expectedTruth` is synthetic, test-only diagnostic truth -- it is never derived from, and never becomes, a real `automotive_knowledge_entries` row or Mehdi case. See [fixtures.ts](../../../lib/automotive/evaluation/fixtures.ts) for the 10 scenarios currently defined.

## Entry points

- `evaluator.ts#evaluateScenario(scenario, output)` -- runs one scenario against one candidate output, returns named pass/fail checks.
- `runner.ts#runEvaluationSuite(scenarios, outputsByScenarioId)` -- runs every scenario that has a matching output and summarizes pass/fail counts.

Both are pure functions: no network calls, no model calls, fully deterministic given the same inputs.

## Candidate output shape

Providers under evaluation are not assumed to use any particular internal format -- the evaluator takes a small provider-agnostic `CandidateDiagnosticOutput` (claims with evidence citations and a fact/hypothesis flag, clarifying questions, next checks, uncertainty/safety flags). Whatever adapts a real provider's response into this shape lives with that provider, not here.
