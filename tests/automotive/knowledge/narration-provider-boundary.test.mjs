// Tests for the narration-provider boundary: no real provider is wired up
// (noProviderConfigured must refuse, not fake extraction), and merging a
// proposed draft never relabels its origin/provenance.
import assert from "node:assert/strict";
import { load } from "../../helpers/load-typescript.mjs";

const knowledgeTypes = load("lib/automotive/knowledge/types.ts", {});
const narrationProvider = load("lib/automotive/knowledge/narrationProvider.ts", { "./types": knowledgeTypes });
const draftBuilder = load("lib/automotive/knowledge/draftBuilder.ts", { "./types": knowledgeTypes });
const mockProvider = load("tests/automotive/knowledge/testSupport/mockCaseDraftProvider.ts", {
  "../../../../lib/automotive/knowledge/types": knowledgeTypes,
  "../../../../lib/automotive/knowledge/narrationProvider": narrationProvider,
});

let passed = 0;
function check(cond, label) {
  assert.ok(cond, label);
  passed++;
}

// --- no real provider configured in production: it refuses, never fakes --
{
  await assert.rejects(
    () => narrationProvider.noProviderConfigured.proposeDraft({ rawNarration: "anything" }),
    "noProviderConfigured refuses to propose a draft rather than fabricating one",
  );
  passed++;
}

// --- a proposed draft merges with a new id but unchanged provenance ------
{
  const proposal = await mockProvider.TEST_ONLY_mockCaseDraftProvider.proposeDraft({
    rawNarration: "Peugeot 206 cranked normally but would not start. Scanner showed zero RPM while cranking.",
  });
  const merged = draftBuilder.fromProposedDraft(proposal, { id: "draft-from-proposal-1" });
  check(merged.id === "draft-from-proposal-1", "merge assigns the new draft id");
  check(merged.origin === "ai_structured", "merge preserves ai_structured origin, never relabels to mechanic_authored");
  check(merged.aiTransformed === true, "merge preserves aiTransformed flag");
  check(merged.isFixture === true, "merge preserves the fixture flag from the (test-only) proposal");
  check(merged.reviewStatus === "draft", "merged draft is still review-required");
}

console.log(`automotive/knowledge/narration-provider-boundary.test.mjs: ${passed} checks passed`);
