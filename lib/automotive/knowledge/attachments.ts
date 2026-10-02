// Mobile Alpha Worker B -- attachment metadata contract for the Teach
// experience. This is metadata ONLY: no binary upload, no storage bucket,
// no OCR/vision extraction happens here or anywhere in this module. A real
// storage/extraction pipeline is a future, separately-authorized piece of
// work; this just defines the shape so the Teach UI can let Mehdi attach a
// photo or document to a draft today without inventing a fake backend for
// it.
export type AttachmentType = "image" | "pdf" | "file";

export type AttachmentReviewState = "pending" | "attached_to_draft" | "discarded";

export interface AttachmentMetadata {
  id: string;
  type: AttachmentType;
  /** Original filename as selected by the user -- never fabricated. */
  filename: string;
  /** Browser/OS-reported MIME type, e.g. "image/jpeg", "application/pdf". */
  mimeType: string;
  sizeBytes: number;
  /** Where this metadata record came from -- e.g. "mobile_camera",
   * "mobile_file_picker" -- for provenance, not a storage path. */
  sourceReference: string;
  /** The draft this attachment is associated with, if any. */
  caseDraftId?: string | null;
  reviewState: AttachmentReviewState;
  createdAt: string;
}

export interface AttachmentValidationResult {
  valid: boolean;
  errors: string[];
}

const MAX_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB -- a sane metadata-only cap; no storage exists to enforce this for real yet.

const MIME_PREFIX_BY_TYPE: Record<AttachmentType, (mime: string) => boolean> = {
  image: (mime) => mime.startsWith("image/"),
  pdf: (mime) => mime === "application/pdf",
  file: () => true, // generic bucket for anything else (e.g. a text note, a scan dump)
};

/**
 * Validates an attachment metadata record. Deterministic, no network, no
 * file-content inspection (there is no storage to inspect) -- this only
 * checks the metadata shape and the declared type/MIME-type consistency.
 */
export function validateAttachmentMetadata(meta: AttachmentMetadata): AttachmentValidationResult {
  const errors: string[] = [];

  if (!meta.filename || meta.filename.trim().length === 0) {
    errors.push("filename is required");
  }
  if (!meta.mimeType || meta.mimeType.trim().length === 0) {
    errors.push("mimeType is required");
  }
  if (!(meta.type in MIME_PREFIX_BY_TYPE)) {
    errors.push(`invalid attachment type: ${String(meta.type)}`);
  } else if (meta.mimeType && !MIME_PREFIX_BY_TYPE[meta.type](meta.mimeType)) {
    errors.push(`mimeType "${meta.mimeType}" is not consistent with declared type "${meta.type}"`);
  }
  if (!Number.isFinite(meta.sizeBytes) || meta.sizeBytes <= 0) {
    errors.push("sizeBytes must be a positive number");
  } else if (meta.sizeBytes > MAX_SIZE_BYTES) {
    errors.push(`sizeBytes exceeds the ${MAX_SIZE_BYTES} byte metadata cap`);
  }
  if (!meta.sourceReference || meta.sourceReference.trim().length === 0) {
    errors.push("sourceReference is required for provenance");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Builds a pending attachment metadata record from a browser File-like
 * object (anything with name/type/size). Pure/deterministic: takes an
 * explicit id/createdAt/sourceReference rather than generating them
 * internally, so callers (and tests) stay in control of non-determinism.
 */
export function buildAttachmentMetadata(
  file: { name: string; type: string; size: number },
  context: { id: string; type: AttachmentType; sourceReference: string; createdAt: string; caseDraftId?: string | null },
): AttachmentMetadata {
  return {
    id: context.id,
    type: context.type,
    filename: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    sourceReference: context.sourceReference,
    caseDraftId: context.caseDraftId ?? null,
    reviewState: "pending",
    createdAt: context.createdAt,
  };
}
