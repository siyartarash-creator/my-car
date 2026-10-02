"use client";
// Mobile Alpha Worker B -- "Review Knowledge" structured editor + explicit
// review actions. Shows every StructuredCaseDraft field, with unknown
// fields clearly marked unknown (never silently blank-as-known). Approve/
// Reject/Edit all go through lib/automotive/knowledge/reviewWorkflow.ts --
// this component never fabricates a review decision on its own.
import { useState } from "react";
import {
  approveDraft,
  editDraft,
  rejectDraft,
  submitForReview,
  ReviewWorkflowError,
  type ReviewableCaseDraft,
} from "@/lib/automotive/knowledge/reviewWorkflow";
import type { QualityWarning } from "@/lib/automotive/knowledge/qualityChecks";
import type { Maybe, StructuredCaseDraft } from "@/lib/automotive/knowledge/types";

export interface StructuredCaseReviewProps {
  reviewable: ReviewableCaseDraft;
  onChange: (reviewable: ReviewableCaseDraft) => void;
  /** Called with the final approved StructuredCaseDraft -- the shape the
   * existing StructuredCaseDraft -> Core CaseIntake adapter consumes. */
  onApproved: (draft: StructuredCaseDraft, warnings: QualityWarning[]) => void;
  reviewerProfileId: string;
  now: () => string;
}

function UnknownField({
  label,
  value,
  onChange,
  textarea = false,
}: {
  label: string;
  value: Maybe<string>;
  onChange: (next: Maybe<string>) => void;
  textarea?: boolean;
}) {
  const known = value.known;
  const fieldClassName = "w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-[#39FF14]";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-sm font-bold text-gray-300">{label}</label>
        <label className="flex items-center gap-1 text-xs text-gray-500">
          <input
            type="checkbox"
            checked={!known}
            onChange={(e) => onChange(e.target.checked ? { known: false } : { known: true, value: "" })}
          />
          نامشخص
        </label>
      </div>
      {known ? (
        textarea ? (
          <textarea
            value={value.value}
            onChange={(e) => onChange({ known: true, value: e.target.value })}
            rows={3}
            className={fieldClassName}
          />
        ) : (
          <input
            value={value.value}
            onChange={(e) => onChange({ known: true, value: e.target.value })}
            className={fieldClassName}
          />
        )
      ) : (
        <p className="rounded-lg border border-dashed border-gray-700 px-3 py-2 text-sm text-gray-500">نامشخص -- ثبت نشده</p>
      )}
    </div>
  );
}

export function StructuredCaseReview({ reviewable, onChange, onApproved, reviewerProfileId, now }: StructuredCaseReviewProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const d = reviewable.draft;

  function patch(updates: Partial<StructuredCaseDraft>) {
    onChange(editDraft(reviewable, updates));
  }

  function handleApprove() {
    setActionError(null);
    try {
      const { reviewable: approved, warnings } = approveDraft(reviewable, {
        reviewerProfileId,
        approvedAt: now(),
      });
      onChange(approved);
      onApproved(approved.draft, warnings);
    } catch (err) {
      setActionError(err instanceof ReviewWorkflowError ? err.message : "تأیید انجام نشد.");
    }
  }

  function handleReject() {
    if (!rejectReason.trim()) {
      setActionError("برای رد کردن، دلیل را بنویس.");
      return;
    }
    setActionError(null);
    onChange(rejectDraft(reviewable, rejectReason.trim()));
  }

  function handleSubmitForReview() {
    setActionError(null);
    try {
      onChange(submitForReview(reviewable));
    } catch (err) {
      setActionError(err instanceof ReviewWorkflowError ? err.message : "ثبت برای بازبینی انجام نشد.");
    }
  }

  const stateLabel: Record<string, string> = {
    draft: "پیش‌نویس",
    needs_review: "در انتظار بازبینی",
    approved: "تأیید شده",
    rejected: "رد شده",
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-lg border border-[#39FF14]/20 px-4 py-2">
        <span className="text-sm text-gray-400">وضعیت بازبینی</span>
        <span className="font-bold text-[#39FF14]">{stateLabel[reviewable.state]}</span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <UnknownField
          label="مارک خودرو"
          value={d.vehicle.make}
          onChange={(make) => patch({ vehicle: { ...d.vehicle, make } })}
        />
        <UnknownField
          label="مدل خودرو"
          value={d.vehicle.model}
          onChange={(model) => patch({ vehicle: { ...d.vehicle, model } })}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-bold text-gray-300">علائم گزارش‌شده</label>
        <textarea
          value={d.reportedSymptoms}
          onChange={(e) => patch({ reportedSymptoms: e.target.value })}
          rows={3}
          className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-[#39FF14]"
        />
      </div>

      <UnknownField label="مشاهدات مکانیک" value={d.mechanicObservations} onChange={(v) => patch({ mechanicObservations: v })} textarea />
      <UnknownField label="تست‌های تشخیصی انجام‌شده" value={d.diagnosticTestsPerformed} onChange={(v) => patch({ diagnosticTestsPerformed: v })} textarea />
      <UnknownField label="نتایج اندازه‌گیری‌شده" value={d.measuredResults} onChange={(v) => patch({ measuredResults: v })} textarea />

      <div>
        <label className="mb-1 block text-sm font-bold text-gray-300">علت‌های احتمالی (هرکدام یک خط)</label>
        <textarea
          value={d.candidateCauses.join("\n")}
          onChange={(e) => patch({ candidateCauses: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
          rows={3}
          className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-[#39FF14]"
        />
      </div>

      <UnknownField label="علت تأیید شده" value={d.confirmedCause} onChange={(v) => patch({ confirmedCause: v })} />
      <UnknownField label="تعمیر/اقدام انجام‌شده" value={d.repairActionPerformed} onChange={(v) => patch({ repairActionPerformed: v })} textarea />
      <UnknownField label="نتیجه نهایی" value={d.outcome} onChange={(v) => patch({ outcome: v })} textarea />
      <UnknownField label="یادداشت مکانیک" value={d.mechanicNotes} onChange={(v) => patch({ mechanicNotes: v })} textarea />

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-bold text-gray-300">اطمینان</label>
          <select
            value={d.confidence}
            onChange={(e) => patch({ confidence: e.target.value as StructuredCaseDraft["confidence"] })}
            className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-3 py-2 text-white"
          >
            <option value="low">کم</option>
            <option value="medium">متوسط</option>
            <option value="high">زیاد</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-bold text-gray-300">سطح ریسک</label>
          <select
            value={d.riskLevel}
            onChange={(e) => patch({ riskLevel: e.target.value as StructuredCaseDraft["riskLevel"] })}
            className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-3 py-2 text-white"
          >
            <option value="informational">اطلاع‌رسانی</option>
            <option value="routine_safe">روتین و بی‌خطر</option>
            <option value="requires_caution">نیاز به احتیاط</option>
            <option value="safety_critical">حیاتی از نظر ایمنی</option>
          </select>
        </div>
        <div className="text-sm text-gray-400">
          <span className="block font-bold text-gray-300">منبع</span>
          {d.origin === "ai_structured" ? "ساختاردهی‌شده توسط AI از روی توضیح متنی" : d.origin === "fixture" ? "داده آزمایشی (fixture)" : "نوشته مستقیم مکانیک"}
        </div>
      </div>

      {actionError && <p className="text-sm text-red-400">{actionError}</p>}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <input
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="دلیل رد کردن (در صورت نیاز)"
            className="w-full rounded-lg border border-red-900 bg-neutral-950 px-3 py-2 text-sm text-white outline-none"
          />
        </div>
        <button type="button" onClick={handleReject} className="rounded-lg border border-red-700 px-4 py-2 text-red-400">
          رد کردن / کنار گذاشتن
        </button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        {reviewable.state === "draft" && (
          <button type="button" onClick={handleSubmitForReview} className="rounded-lg border border-[#39FF14]/40 px-4 py-3 font-bold text-[#39FF14]">
            ثبت برای بازبینی
          </button>
        )}
        <button
          type="button"
          onClick={handleApprove}
          disabled={reviewable.state === "approved"}
          className="rounded-lg bg-[#39FF14] px-4 py-3 font-bold text-black disabled:opacity-40"
        >
          تأیید نهایی (توسط {reviewerProfileId})
        </button>
      </div>
    </div>
  );
}
