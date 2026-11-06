import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

const MAX_SIZE = 5 * 1024 * 1024;

function detectImage(bytes: Uint8Array): { contentType: string; extension: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return { contentType: "image/png", extension: "png" };
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return { contentType: "image/webp", extension: "webp" };
  }
  return null;
}

export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "لطفاً دوباره وارد شوید" }, { status: 401 });

  const { data: profile } = await client.from("profiles").select("is_admin").eq("id", user.id).single();
  if (profile?.is_admin !== true) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 403 });

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "فایل ارسال نشده است" }, { status: 400 });
    if (file.size === 0 || file.size > MAX_SIZE) return NextResponse.json({ error: "حجم فایل نامعتبر است" }, { status: 413 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const detected = detectImage(bytes);
    if (!detected) return NextResponse.json({ error: "فقط JPG، PNG یا WebP مجاز است" }, { status: 415 });

    const path = `products/${randomUUID()}.${detected.extension}`;
    const { error } = await client.storage.from("products").upload(path, bytes, {
      contentType: detected.contentType,
      upsert: false,
    });
    if (error) return NextResponse.json({ error: "آپلود تصویر انجام نشد" }, { status: 502 });

    const { data } = client.storage.from("products").getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl, path });
  } catch {
    return NextResponse.json({ error: "درخواست آپلود نامعتبر است" }, { status: 400 });
  }
}
