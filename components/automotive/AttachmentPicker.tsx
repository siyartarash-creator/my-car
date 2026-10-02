"use client";
// Mobile Alpha Worker B -- attachment metadata picker for the Teach
// experience. Metadata ONLY: picking a file here never uploads it anywhere
// and never runs OCR/vision extraction -- it just records what the user
// attached (filename/mime/size/source) so a future storage/extraction
// pipeline has something real to attach to once it's authorized.
import { useRef, useState } from "react";
import { buildAttachmentMetadata, validateAttachmentMetadata, type AttachmentMetadata, type AttachmentType } from "@/lib/automotive/knowledge/attachments";

export interface AttachmentPickerProps {
  caseDraftId: string | null;
  attachments: AttachmentMetadata[];
  onChange: (attachments: AttachmentMetadata[]) => void;
  generateId: () => string;
  now: () => string;
}

function guessType(file: File): AttachmentType {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf") return "pdf";
  return "file";
}

export function AttachmentPicker({ caseDraftId, attachments, onChange, generateId, now }: AttachmentPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    const next: AttachmentMetadata[] = [];
    for (const file of Array.from(fileList)) {
      const meta = buildAttachmentMetadata(file, {
        id: generateId(),
        type: guessType(file),
        sourceReference: "mobile_file_picker",
        createdAt: now(),
        caseDraftId,
      });
      const result = validateAttachmentMetadata(meta);
      if (!result.valid) {
        setError(`فایل «${file.name}» پذیرفته نشد: ${result.errors.join("، ")}`);
        continue;
      }
      next.push(meta);
    }
    if (next.length > 0) onChange([...attachments, ...next]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleDiscard(id: string) {
    onChange(
      attachments.map((a) => (a.id === id ? { ...a, reviewState: "discarded" } : a)),
    );
  }

  return (
    <div className="space-y-3">
      <label className="mb-1 block text-sm font-bold text-gray-300">ضمیمه (عکس یا فایل) -- اختیاری</label>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,application/pdf"
        onChange={(e) => handleFiles(e.target.files)}
        className="block w-full text-sm text-gray-400"
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <ul className="space-y-1">
        {attachments
          .filter((a) => a.reviewState !== "discarded")
          .map((a) => (
            <li key={a.id} className="flex items-center justify-between rounded-lg border border-[#39FF14]/20 px-3 py-2 text-sm">
              <span className="truncate text-gray-300">{a.filename}</span>
              <button type="button" onClick={() => handleDiscard(a.id)} className="text-red-400">
                حذف
              </button>
            </li>
          ))}
      </ul>
      <p className="text-xs text-gray-500">این ضمیمه فعلاً فقط به‌عنوان اطلاعات ثبت می‌شود -- آپلود یا پردازش خودکار تصویر هنوز فعال نیست.</p>
    </div>
  );
}
