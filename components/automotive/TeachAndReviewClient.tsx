"use client";
// Mobile Alpha integration -- orchestrates TeachCaseForm -> StructuredCaseReview
// -> AttachmentPicker -> final submit. Holds all state in memory (no
// persistence happens until the explicit final submit, which the caller's
// `onSubmit` wires to a server action that re-derives the real authenticated
// author id server-side -- it is never trusted from this client state).
import { useState } from "react";
import { AttachmentPicker } from "./AttachmentPicker";
import { StructuredCaseReview } from "./StructuredCaseReview";
import { TeachCaseForm } from "./TeachCaseForm";
import type { AttachmentMetadata } from "@/lib/automotive/knowledge/attachments";
import type { QualityWarning } from "@/lib/automotive/knowledge/qualityChecks";
import type { ReviewableCaseDraft } from "@/lib/automotive/knowledge/reviewWorkflow";
import type { StructuredCaseDraft } from "@/lib/automotive/knowledge/types";

export interface TeachAndReviewClientProps {
  reviewerProfileId: string;
  onSubmit: (reviewable: ReviewableCaseDraft) => Promise<{ id: string } | { error: string }>;
}

export function TeachAndReviewClient({ reviewerProfileId, onSubmit }: TeachAndReviewClientProps) {
  const [reviewable, setReviewable] = useState<ReviewableCaseDraft | null>(null);
  const [attachments, setAttachments] = useState<AttachmentMetadata[]>([]);
  const [warnings, setWarnings] = useState<QualityWarning[]>([]);
  const [submitResult, setSubmitResult] = useState<{ id: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const generateId = () => crypto.randomUUID();
  const now = () => new Date().toISOString();

  function handleApproved(_draft: StructuredCaseDraft, qualityWarnings: QualityWarning[]) {
    setWarnings(qualityWarnings);
  }

  async function handleFinalSubmit() {
    if (!reviewable) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await onSubmit(reviewable);
      if ("error" in result) {
        setSubmitError(result.error);
      } else {
        setSubmitResult(result);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "ثبت نهایی انجام نشد.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitResult) {
    return (
      <p className="rounded-lg border border-[#39FF14]/40 px-4 py-3 text-[#39FF14]">
        مورد با شناسه {submitResult.id} ثبت شد و در انتظار بازبینی نهایی ادمین است.
      </p>
    );
  }

  if (!reviewable) {
    return <TeachCaseForm generateId={generateId} onDraftReady={setReviewable} />;
  }

  return (
    <div className="space-y-6">
      <StructuredCaseReview
        reviewable={reviewable}
        onChange={setReviewable}
        onApproved={handleApproved}
        reviewerProfileId={reviewerProfileId}
        now={now}
      />
      <AttachmentPicker
        caseDraftId={reviewable.draft.id}
        attachments={attachments}
        onChange={setAttachments}
        generateId={generateId}
        now={now}
      />
      {warnings.length > 0 && (
        <ul className="space-y-1 text-sm text-yellow-400">
          {warnings.map((w) => (
            <li key={w.code}>{w.message}</li>
          ))}
        </ul>
      )}
      {reviewable.state === "approved" && (
        <button
          type="button"
          onClick={handleFinalSubmit}
          disabled={submitting}
          className="w-full rounded-lg bg-[#39FF14] px-4 py-3 font-bold text-black disabled:opacity-40"
        >
          {submitting ? "در حال ثبت..." : "ثبت نهایی برای بازبینی ادمین"}
        </button>
      )}
      {submitError && <p className="text-sm text-red-400">{submitError}</p>}
    </div>
  );
}
