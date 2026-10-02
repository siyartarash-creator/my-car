"use client";
// Mobile Alpha Worker B -- "Teach MY CAR" entry point. Mobile-first: free
// narration textarea, optional AI-assisted structuring (only if a real
// CaseDraftProvider is injected -- there is none yet in this repo, so the
// default path is always manual structured entry), and a path straight to
// manual entry. This component owns none of the review workflow -- it only
// produces a fresh ReviewableCaseDraft and hands it off via onDraftReady,
// so a host route/page decides what screen comes next.
import { useState } from "react";
import { createEmptyDraft, fromProposedDraft } from "@/lib/automotive/knowledge/draftBuilder";
import { noProviderConfigured, type CaseDraftProvider } from "@/lib/automotive/knowledge/narrationProvider";
import { toReviewable, type ReviewableCaseDraft } from "@/lib/automotive/knowledge/reviewWorkflow";

export interface TeachCaseFormProps {
  /** Injected by whoever mounts this -- omit to keep the manual-only path
   * (the correct default today, since no real provider is wired up). */
  provider?: CaseDraftProvider;
  /** Generates a new draft id -- injected so the component stays pure/testable. */
  generateId: () => string;
  onDraftReady: (reviewable: ReviewableCaseDraft) => void;
}

export function TeachCaseForm({ provider = noProviderConfigured, generateId, onDraftReady }: TeachCaseFormProps) {
  const [narration, setNarration] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasRealProvider = provider !== noProviderConfigured;

  async function handleProposeFromNarration() {
    setError(null);
    setPending(true);
    try {
      const proposal = await provider.proposeDraft({ rawNarration: narration });
      onDraftReady(toReviewable(fromProposedDraft(proposal, { id: generateId() })));
    } catch {
      setError("استخراج خودکار در دسترس نیست -- لطفاً مورد را به‌صورت دستی وارد کن.");
    } finally {
      setPending(false);
    }
  }

  function handleStartManualEntry() {
    const draft = createEmptyDraft({ id: generateId() });
    const seeded = narration.trim() ? { ...draft, reportedSymptoms: narration.trim() } : draft;
    onDraftReady(toReviewable(seeded));
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-2 block text-sm font-bold text-gray-300">
          مورد واقعی رو با زبان خودت توضیح بده
        </label>
        <textarea
          value={narration}
          onChange={(e) => setNarration(e.target.value)}
          placeholder="مثلاً: پژو ۲۰۶، استارت می‌خورد ولی روشن نمی‌شد. دستگاه دیاگ موقع استارت دور موتور صفر نشون می‌داد..."
          rows={5}
          className="w-full rounded-lg border border-[#39FF14]/20 bg-neutral-950 px-4 py-3 text-white outline-none transition focus:border-[#39FF14]"
        />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-col gap-2 sm:flex-row">
        {hasRealProvider && (
          <button
            type="button"
            onClick={handleProposeFromNarration}
            disabled={pending || !narration.trim()}
            className="rounded-lg bg-[#39FF14] px-4 py-3 font-bold text-black disabled:opacity-40"
          >
            {pending ? "در حال تبدیل..." : "تبدیل به فرم ساختاریافته"}
          </button>
        )}
        <button
          type="button"
          onClick={handleStartManualEntry}
          className="rounded-lg border border-[#39FF14]/40 px-4 py-3 font-bold text-[#39FF14]"
        >
          ورود دستی ساختاریافته
        </button>
      </div>

      {!hasRealProvider && (
        <p className="text-xs text-gray-500">
          فعلاً تبدیل خودکار فعال نیست -- متن بالا رو می‌تونی به‌عنوان نقطه شروع در فرم دستی ویرایش کنی.
        </p>
      )}
    </div>
  );
}
