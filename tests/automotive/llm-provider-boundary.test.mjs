// Tests for the structured LLM provider boundary: a provider's output is
// only accepted after independent re-validation, never because it returned
// well-formed JSON. Simulates a misbehaving provider to prove rejection.
import assert from "node:assert/strict";
import { load } from "../helpers/load-typescript.mjs";

const evidence = load("lib/automotive/evidence.ts", { "./types": {} });
const claims = load("lib/automotive/claims.ts", { "./evidence": evidence, "./types": {} });
const llmProvider = load("lib/automotive/llmProvider.ts", { "./claims": claims, "./evidence": evidence, "./types": {} });

let passed = 0;

const knownEvidence = [{ id: "evidence:entry:1", type: "knowledge_entry", source: "entry 1", content: "x -> y" }];
const request = llmProvider.buildStructuredRequest({ question: "q" }, knownEvidence);

// --- a provider citing real evidence with a valid claim type passes ------
{
  const result = llmProvider.validateStructuredResult(
    { claims: [{ type: "HYPOTHESIS", text: "maybe y", evidenceIds: ["evidence:entry:1"] }] },
    request,
  );
  assert.ok(result && result.length === 1, "valid structured claim accepted");
  passed++;
}

// --- a provider citing fabricated evidence is dropped, not accepted ------
{
  const result = llmProvider.validateStructuredResult(
    { claims: [{ type: "FACT", text: "fabricated", evidenceIds: ["evidence:entry:does-not-exist"] }] },
    request,
  );
  assert.deepEqual(result, [], "claim citing nonexistent evidence is dropped");
  passed++;
}

// --- a provider misclassifying a hypothesis as FACT without retrieved evidence is dropped
{
  const result = llmProvider.validateStructuredResult(
    { claims: [{ type: "FACT", text: "inferred, not retrieved", evidenceIds: [] }] },
    request,
  );
  assert.deepEqual(result, [], "FACT with no evidence is dropped, not accepted as fact");
  passed++;
}

// --- malformed provider output (not an array of claims) is rejected outright
{
  const result = llmProvider.validateStructuredResult({ claims: "not-an-array" }, request);
  assert.equal(result, null, "malformed structured output rejected outright");
  passed++;
}

console.log(`automotive llm-provider-boundary: ${passed} checks passed`);
