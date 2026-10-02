// Mobile Alpha -- "Teach MY CAR" private page. Admin-gated (same pattern as
// app/automotive/assistant), mobile-first single column, no new auth/RLS
// mechanism. Real narration AI, attachment upload, and OCR are intentionally
// not wired up yet -- see components/automotive/AttachmentPicker.tsx, which
// visibly marks attachments as metadata-only rather than faking an upload.
import { requireRole } from "@/lib/auth-server";
import { TeachAndReviewClient } from "@/components/automotive/TeachAndReviewClient";
import { submitTeachCase } from "./actions";

export default async function TeachMyCarPage() {
  const { user } = await requireRole("admin");

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-2 text-xl font-bold text-white">آموزش MY CAR</h1>
      <p className="mb-6 text-sm text-gray-400">
        مورد واقعی که خودت دیاگنوز یا تعمیر کردی رو ثبت کن. قبل از این‌که وارد دانش واقعی بشه، باید خودت صراحتاً تأیید کنی.
      </p>
      <TeachAndReviewClient reviewerProfileId={user.id} onSubmit={submitTeachCase} />
    </main>
  );
}
