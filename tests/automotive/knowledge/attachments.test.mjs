// Tests for the attachment metadata contract: validation and the
// File-like-object -> metadata builder. No storage, no upload, no network.
import assert from "node:assert/strict";
import { load } from "../../helpers/load-typescript.mjs";

const attachments = load("lib/automotive/knowledge/attachments.ts", {});
const { validateAttachmentMetadata, buildAttachmentMetadata } = attachments;

let passed = 0;
function check(cond, label) {
  assert.ok(cond, label);
  passed++;
}

function validMeta(overrides = {}) {
  return {
    id: "att-1",
    type: "image",
    filename: "coolant-leak.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 1024 * 200,
    sourceReference: "mobile_camera",
    caseDraftId: "draft-1",
    reviewState: "pending",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// --- a well-formed attachment passes validation ---------------------------
{
  const result = validateAttachmentMetadata(validMeta());
  check(result.valid === true && result.errors.length === 0, "well-formed image attachment is valid");
}

// --- attachment metadata validation: mismatched type/mime rejected --------
{
  const result = validateAttachmentMetadata(validMeta({ type: "pdf", mimeType: "image/jpeg" }));
  check(!result.valid, "pdf type with image mimeType is rejected");
  check(result.errors.some((e) => e.includes("not consistent")), "error names the mismatch");
}

// --- missing required metadata rejected ------------------------------------
{
  const result = validateAttachmentMetadata(validMeta({ filename: "" }));
  check(!result.valid, "empty filename rejected");

  const result2 = validateAttachmentMetadata(validMeta({ sourceReference: "" }));
  check(!result2.valid, "missing sourceReference (provenance) rejected");
}

// --- size bounds enforced ---------------------------------------------------
{
  const result = validateAttachmentMetadata(validMeta({ sizeBytes: 0 }));
  check(!result.valid, "zero-byte size rejected");

  const result2 = validateAttachmentMetadata(validMeta({ sizeBytes: 50 * 1024 * 1024 }));
  check(!result2.valid, "oversized attachment rejected");
}

// --- generic "file" type accepts any mimeType ------------------------------
{
  const result = validateAttachmentMetadata(validMeta({ type: "file", mimeType: "text/plain", filename: "notes.txt" }));
  check(result.valid, "generic file type accepts a non-image/pdf mimeType");
}

// --- builder produces a pending, draft-linked record from a File-like object --
{
  const file = { name: "manual-scan.pdf", type: "application/pdf", size: 500_000 };
  const meta = buildAttachmentMetadata(file, {
    id: "att-2",
    type: "pdf",
    sourceReference: "mobile_file_picker",
    createdAt: "2026-01-01T00:00:00Z",
    caseDraftId: "draft-7",
  });
  check(meta.reviewState === "pending", "builder always starts in pending review state");
  check(meta.filename === "manual-scan.pdf" && meta.mimeType === "application/pdf" && meta.sizeBytes === 500_000, "file fields carried through verbatim, nothing fabricated");
  check(meta.caseDraftId === "draft-7", "caseDraftId association preserved");
  check(validateAttachmentMetadata(meta).valid, "builder output passes validation");
}

console.log(`automotive/knowledge/attachments.test.mjs: ${passed} checks passed`);
