import { NominatimGeocodingAdapter } from "@/lib/map/adapters/geocoding-nominatim";
import { CircuitBreaker } from "@/lib/map/resilience";

const adapter = new NominatimGeocodingAdapter();

// Process-local throttle enforcing Nominatim's usage policy ("no more than
// 1 request per second" from this application as a whole, not per user).
// This resets per server instance/restart and doesn't coordinate across
// multiple instances -- acceptable at this project's current $0/single-
// instance scale; a scaled deployment would need a shared limiter (e.g.
// Postgres or Redis-backed) instead of this in-memory one.
let lastCallAt = 0;
const MIN_INTERVAL_MS = 1100;

// Failure isolation: after 5 consecutive Nominatim failures (including
// the 5s AbortSignal timeout in the adapter), stop calling it for 30s
// rather than letting every search request re-discover the same timeout
// one at a time. Same in-memory, single-instance caveat as the throttle
// above.
const breaker = new CircuitBreaker({ failureThreshold: 5, openDurationMs: 30_000 });

export async function GET(request: Request) {
  const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2 || q.length > 200) return reply({ status: "ok", data: [] });

  const now = Date.now();
  if (now - lastCallAt < MIN_INTERVAL_MS) {
    return reply(
      { status: "capability_disabled", capability: "geocoding", reason: "نرخ درخواست محدود است؛ کمی صبر کنید" },
      429,
    );
  }
  lastCallAt = now;

  try {
    const result = await breaker.execute(() => adapter.search(q));
    return reply(result);
  } catch (err) {
    const reason =
      err instanceof Error && err.message === "circuit_open"
        ? "جستجوی مکان به‌طور موقت به دلیل خطاهای مکرر غیرفعال شده؛ کمی بعد دوباره تلاش کنید"
        : "جستجوی مکان موقتاً در دسترس نیست";
    return reply({ status: "capability_disabled", capability: "geocoding", reason }, 502);
  }
}
