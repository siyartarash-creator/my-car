// Phase 3 Part 4: the honest $0 offline layer this web stack can actually
// support -- a per-device, browser-local cache of the last successful Map
// read, served (clearly labeled stale) when a fresh fetch fails. This is
// NOT offline tiles or offline routing -- see offline_tiles/
// offline_navigation in capabilities.ts for why those need real
// infrastructure or a native app that don't exist yet. This module never
// talks to the network itself and never silently hides staleness from
// the caller.
import { isCapabilityEnabled } from "./capabilities";

export type CachedSnapshot<T> = {
  data: T;
  cachedAt: string; // ISO timestamp
};

const PREFIX = "mycar:map:offline:";

// localStorage can throw (private browsing, quota, disabled storage) or
// simply be unavailable (server-side rendering) -- every call here is
// wrapped so a storage failure degrades to "no cache," never a crash.
function safeGetStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function cacheSnapshot<T>(key: string, data: T): void {
  if (!isCapabilityEnabled("offline_cache")) return;
  const storage = safeGetStorage();
  if (!storage) return;
  try {
    const snapshot: CachedSnapshot<T> = { data, cachedAt: new Date().toISOString() };
    storage.setItem(PREFIX + key, JSON.stringify(snapshot));
  } catch {
    // Quota exceeded or serialization failure -- caching is a best-effort
    // convenience, never something a caller should have to handle.
  }
}

export function getCachedSnapshot<T>(key: string): CachedSnapshot<T> | null {
  if (!isCapabilityEnabled("offline_cache")) return null;
  const storage = safeGetStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as CachedSnapshot<T>;
  } catch {
    return null;
  }
}

// A stable, bounded-precision cache key for "this map area" -- rounded so
// small pans/zooms within the same neighborhood still hit the same
// cached entry, instead of every pixel of movement missing the cache.
export function areaCacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}
