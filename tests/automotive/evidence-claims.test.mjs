// Tests for the Milestone 2 claim/evidence contract: unknown evidence ids
// must fail validation, FACT must cite retrieved knowledge, and the
// deterministic contract's own claim output must always validate clean.
import assert from "node:assert/strict";
import { load } from "../helpers/load-typescript.mjs";
import { FIXTURE_ENTRIES } from "./fixtures.mjs";

const evidence = load("lib/automotive/evidence.ts", { "./types": {} });
const claims = load("lib/automotive/claims.ts", { "./evidence": evidence, "./types": {} });
const safety = load("lib/automotive/safety.ts");
const retrieval = load("lib/automotive/retrieval.ts", { "./types": {} });
const contract = load("lib/automotive/diagnosticContract.ts", {
  "./retrieval": retrieval,
  "./safety": safety,
  "./evidence": evidence,
  "./claims": claims,
  "./types": {},
});

let passed = 0;
function check(cond, label) {
  assert.ok(cond, label);
  passed++;
}

// --- unknown evidence id fails validation --------------------------------
{
  const index = new evidence.EvidenceIndex([]);
  assert.throws(
    () => claims.validateClaims([{ type: "FACT", text: "x", evidenceIds: ["nonexistent"] }], index),
    claims.ClaimValidationError,
    "unknown evidence id rejected",
  );
  passed++;
}

// --- FACT must cite knowledge_entry evidence, not a bare observation ----
{
  const obsItem = { id: "evidence:observation:0", type: "user_observation", source: "observation", content: "noise" };
  const index = new evidence.EvidenceIndex([obsItem]);
  assert.throws(
    () => claims.validateClaims([{ type: "FACT", text: "x", evidenceIds: [obsItem.id] }], index),
    claims.ClaimValidationError,
    "FACT citing only an observation is rejected",
  );
  passed++;
}

// --- SAFETY_NOTICE requires evidence --------------------------------------
{
  const index = new evidence.EvidenceIndex([]);
  assert.throws(
    () => claims.validateClaims([{ type: "SAFETY_NOTICE", text: "x", evidenceIds: [] }], index),
    claims.ClaimValidationError,
    "SAFETY_NOTICE with no evidence is rejected",
  );
  passed++;
}

// --- HYPOTHESIS may carry partial/no evidence without failing -----------
{
  const index = new evidence.EvidenceIndex([]);
  assert.doesNotThrow(() => claims.validateClaims([{ type: "HYPOTHESIS", text: "x", evidenceIds: [] }], index));
  passed++;
}

// --- the deterministic contract's own output always validates clean ------
{
  const response = contract.runDiagnosticQuery(FIXTURE_ENTRIES.filter((e) => e.isFixture), {
    question: "engine cranks but does not start",
    vehicle: { make: "Toyota" },
  }, { includeFixtures: true });
  const index = new evidence.EvidenceIndex(response.evidence);
  assert.doesNotThrow(() => claims.validateClaims(response.claims, index), "contract output is self-consistent evidence-wise");
  passed++;

  check(response.claims.some((c) => c.type === "HYPOTHESIS"), "a HYPOTHESIS claim is produced for a possible cause");
  check(!response.claims.some((c) => c.type === "FACT" && c.text.includes("Possible cause for this vehicle")), "a causal claim never masquerades as FACT text");
}

console.log(`automotive evidence-claims: ${passed} checks passed`);
