"use client";

export async function secureWrite(action: string, payload: Record<string, unknown>) {
  try {
    const response = await fetch(`/api/write/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) return { data: null, error: { message: result.error || "درخواست انجام نشد", code: result.code as string | undefined } };
    return { data: result, error: null };
  } catch {
    return { data: null, error: { message: "ارتباط برقرار نشد؛ دوباره تلاش کنید", code: undefined as string | undefined } };
  }
}
