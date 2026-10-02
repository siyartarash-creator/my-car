# Mobile Alpha -- Teach MY CAR / Review Knowledge (Worker B)

Status: isolated application/domain layer only. No database migration, no routes mounted into app navigation, no real narration provider, no storage/OCR. Built on `track-b-knowledge-eval` (based on the Milestone 1 checkpoint `6e86867`) -- **not** merged with Core Milestone 2 or Mobile Alpha Core. This document is what Worker A/PM needs to mount these pieces into real routes later.

## Why a separate pre-intake layer

See [`docs/automotive/knowledge/README.md`](./README.md) for the `StructuredCaseDraft` contract itself. This document covers what was added on top of it for Mobile Alpha: an explicit review workflow, an attachment metadata contract, and three portable UI components.

## Exports Worker A/Core should consume

| Module | Export | Shape |
|---|---|---|
| `lib/automotive/knowledge/reviewWorkflow.ts` | `ReviewableCaseDraft`, `ReviewState` (`"draft"\|"needs_review"\|"approved"\|"rejected"`) | The workflow wrapper around a `StructuredCaseDraft`. |
| | `toReviewable`, `submitForReview`, `editDraft`, `approveDraft`, `rejectDraft` | State transitions. `editDraft` always resets to `"draft"` and clears review metadata. `approveDraft` is the only approval boundary -- throws `ReviewWorkflowError` for fixtures or structurally invalid drafts. |
| | `toReadyForIntakeResult(reviewable): StructuredCaseDraft` | The **only** way to get an intake-ready result; throws unless `state === "approved"`. Returns the same `StructuredCaseDraft` shape the existing Knowledge-worker `toCaseIntake.ts` adapter (built on the Milestone 2 integration branch) consumes -- no new shape introduced. |
| `lib/automotive/knowledge/draftBuilder.ts` | `createEmptyDraft(context)`, `fromProposedDraft(proposal, context)` | Manual-entry starting point and the proposal-merge step; neither ever changes `origin`/`provenance`/`aiTransformed`. |
| `lib/automotive/knowledge/narrationProvider.ts` | `CaseDraftProvider`, `NaturalCaseInput`, `noProviderConfigured` | Unchanged interface; the mock implementation that used to live here has moved to `tests/automotive/knowledge/testSupport/mockCaseDraftProvider.ts` -- production code now has no fake extractor, only the interface and a safe default that refuses rather than fabricates. |
| `lib/automotive/knowledge/attachments.ts` | `AttachmentMetadata`, `AttachmentType`, `validateAttachmentMetadata`, `buildAttachmentMetadata` | Metadata-only attachment contract -- no binary/storage. |
| `components/automotive/TeachCaseForm.tsx` | `TeachCaseForm({ provider?, generateId, onDraftReady })` | Narration entry point. Defaults to manual-only (no `provider` prop supplied -> `noProviderConfigured`). Produces a `ReviewableCaseDraft` via `onDraftReady`. |
| `components/automotive/StructuredCaseReview.tsx` | `StructuredCaseReview({ reviewable, onChange, onApproved, reviewerProfileId, now })` | Full field editor + review actions. Calls `onApproved(draft, warnings)` only once `approveDraft` has actually succeeded. |
| `components/automotive/AttachmentPicker.tsx` | `AttachmentPicker({ caseDraftId, attachments, onChange, generateId, now })` | Client-side-only file picker producing `AttachmentMetadata[]`; never uploads. |

## Mounting into real routes

None of the three components assume a route, a layout, or a server action -- they take plain props and callbacks. A host page (Worker A's `app/.../teach/page.tsx`, `app/.../review/page.tsx`) is expected to:

1. Provide `generateId`/`now` (e.g. `crypto.randomUUID`, `() => new Date().toISOString()`).
2. Hold the in-memory `ReviewableCaseDraft` (and `AttachmentMetadata[]`) in its own state -- there is no persistence here.
3. On `onApproved`, hand the resulting `StructuredCaseDraft` to wherever `draftToCaseIntakeInput` (Milestone 2 integration branch) or an equivalent is wired up, and supply the real authenticated admin's profile id as `reviewerProfileId`.
4. Enforce auth/role-gating itself (e.g. `requireRole("admin")`) -- these components intentionally have no `requireRole`/Supabase dependency so they stay portable and testable without a live backend.

## Provenance / safety guarantees carried into Mobile Alpha

- **Unknown stays unknown**: every optional field is `Maybe<T>`; the review editor shows an explicit "نامشخص" (unknown) toggle rather than ever defaulting to an empty-but-known value.
- **AI structuring is never silently promoted to mechanic authorship**: `fromProposedDraft` and `editDraft` never touch `origin`/`aiTransformed`; only a human explicitly editing those specific fields changes them.
- **Approval is explicit and re-required after edits**: `approveDraft` requires a `reviewerProfileId` and timestamp supplied by the caller (never inferred), and any `editDraft` call resets state to `"draft"` and clears prior review metadata.
- **Fixtures can never become real knowledge**: `approveDraft` throws for any draft with `isFixture: true`, independent of (and in addition to) `validateCaseDraft`'s own fixture/publication rule.
- **No fabricated extraction**: `noProviderConfigured` throws rather than returning a fake structured draft; the only mock implementation lives under `tests/` and is never imported from `lib/` or `components/`.

## Attachment contract limitations (by design)

`AttachmentMetadata` has no binary payload and no storage path -- `sourceReference` records *how* the metadata was captured (e.g. `"mobile_file_picker"`), not where a file lives. Wiring real storage/OCR/vision is explicitly out of scope here and was not started.

## Shared changes requested

NONE. No shared Core file, migration, RLS policy, `package.json`, `package-lock.json`, or app layout was modified or needed modification to build this layer.
