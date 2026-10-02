// Pure-logic tests for the Track B diagnostic contract: retrieval, safety
// gating, provenance/confidence behavior, unsupported-evidence handling, and
// fixture separation. No database involved -- see schema-security.mjs for
// RLS/provenance-at-the-DB-level coverage.
import assert from "node:assert/strict";
import { load } from "../helpers/load-typescript.mjs";
import { FIXTURE_ENTRIES } from "./fixtures.mjs";

const safety = load("lib/automotive/safety.ts");
const retrieval = load("lib/automotive/retrieval.ts", { "./types": {} });
const contract = load("lib/automotive/diagnosticContract.ts", {
  "./retrieval": retrieval,
  "./safety": safety,
  "./types": {},
});

let passed = 0;
function check(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  passed++;
}

// --- retrieval behavior -----------------------------------------------
{
  const matches = retrieval.retrieveKnowledge(FIXTURE_ENTRIES, { question: "engine cranks but does not start" }, { includeFixtures: true });
  check(matches.map((m) => m.id).sort(), ["fx-1", "fx-2"], "retrieves both no-start matches");
  check(matches[0].id, "fx-1", "ranks higher-confidence match first");
}

// --- vehicle applicability filter --------------------------------------
{
  const matches = retrieval.retrieveKnowledge(
    FIXTURE_ENTRIES,
    { question: "engine cranks but does not start", vehicle: { make: "Honda" } },
    { includeFixtures: true },
  );
  check(matches.map((m) => m.id), ["fx-1"], "excludes vehicle-specific entry for non-matching make");
}

// --- fixture separation --------------------------------------------------
{
  const matches = retrieval.retrieveKnowledge(FIXTURE_ENTRIES, { question: "engine cranks but does not start" });
  check(matches, [], "fixtures excluded from retrieval by default (production path)");
}

// --- draft entries never retrieved regardless of fixture flag ----------
{
  const matches = retrieval.retrieveKnowledge(FIXTURE_ENTRIES, { question: "overheats idle" }, { includeFixtures: true });
  check(matches, [], "draft (unpublished) entry is never retrieved");
}

// --- unsupported-evidence / insufficient-data behavior ------------------
{
  const response = contract.runDiagnosticQuery(FIXTURE_ENTRIES.filter((e) => e.isFixture), {
    question: "transmission makes a whining noise",
  });
  check(response.status, "insufficient_data", "no fabricated cause when nothing matches");
  check(response.findings, [], "no findings when insufficient data");
}

// --- safety gating: safety_critical never gets action guidance ----------
{
  const response = contract.runDiagnosticQuery(FIXTURE_ENTRIES.filter((e) => e.isFixture), {
    question: "soft brake pedal",
    allowActionGuidance: true,
  }, { includeFixtures: true });
  const finding = response.findings.find((f) => f.entryId === "fx-3");
  check(finding.actionGuidance, null, "safety_critical finding withholds action guidance even when authorized");
  check(response.notes.length > 0, true, "safety-critical note is surfaced");
}

// --- requires_caution: gated behind explicit authorization ---------------
{
  const unauthorized = contract.runDiagnosticQuery(FIXTURE_ENTRIES.filter((e) => e.isFixture), {
    question: "engine cranks but does not start",
    vehicle: { make: "Toyota" },
  }, { includeFixtures: true });
  const cautionFinding = unauthorized.findings.find((f) => f.entryId === "fx-2");
  check(cautionFinding.actionGuidance, null, "requires_caution withholds action guidance without authorization");

  const authorized = contract.runDiagnosticQuery(FIXTURE_ENTRIES.filter((e) => e.isFixture), {
    question: "engine cranks but does not start",
    vehicle: { make: "Toyota" },
    allowActionGuidance: true,
  }, { includeFixtures: true });
  const authorizedFinding = authorized.findings.find((f) => f.entryId === "fx-2");
  check(authorizedFinding.actionGuidance, "replace fuel pump or filter as indicated", "requires_caution grants action guidance when explicitly authorized");
}

// --- routine_safe: action guidance always included -----------------------
{
  const response = contract.runDiagnosticQuery(FIXTURE_ENTRIES.filter((e) => e.isFixture), {
    question: "engine cranks but does not start",
  }, { includeFixtures: true });
  const finding = response.findings.find((f) => f.entryId === "fx-1");
  check(finding.actionGuidance, "replace the ignition coil", "routine_safe always includes action guidance");
}

console.log(`automotive diagnostic-contract: ${passed} checks passed`);
