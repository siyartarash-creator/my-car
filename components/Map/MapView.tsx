"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap, Marker, MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Turbopack's dev worker-chunk resolution serves the Next.js 404 page
// instead of maplibre-gl's worker module ("Worker failed to load"); a
// statically-served copy (see scripts/copy-maplibre-worker.mjs) sidesteps
// that resolution path entirely.
if (typeof window !== "undefined") {
  maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
}
import { supabase } from "@/lib/supabase";
import { getTileStyle, getNearbyFeatures, getNearbyServiceLocations, previewRoute, searchPlaces, submitCommunityReport } from "@/lib/map/ai-contracts";
import type { LatLng, MapFeature, MapServiceLocation } from "@/lib/map/types";
import type { GeocodeResult, RoutePreview } from "@/lib/map/ports";

const ROUTE_SOURCE_ID = "map-route-preview";
const ROUTE_LAYER_ID = "map-route-preview-line";

type Category = { id: number; slug: string; name_fa: string; icon: string | null };

const TEHRAN_CENTER: LatLng = { lat: 35.6997, lng: 51.338 };
const SEARCH_RADIUS_METERS = 25_000;

// This project does not log or persist a trail -- only the current map
// center/marker set lives in component state, and Locate Me calls
// getCurrentPosition once (no watchPosition / background tracking).
export default function MapView({ categories }: { categories: Category[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const tileStyle = getTileStyle();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [services, setServices] = useState<MapServiceLocation[]>([]);
  const [features, setFeatures] = useState<MapFeature[]>([]);
  const [activeCategoryIds, setActiveCategoryIds] = useState<Set<number>>(
    () => new Set(categories.map((c) => c.id)),
  );
  const [mode, setMode] = useState<"none" | "report" | "route">("none");
  const [reportDraft, setReportDraft] = useState<{ point: LatLng; description: string } | null>(null);
  const [reportStatus, setReportStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [routePoints, setRoutePoints] = useState<LatLng[]>([]);
  const [routeResult, setRouteResult] = useState<RoutePreview | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const categoryById = Object.fromEntries(categories.map((c) => [c.id, c]));

  const loadNearby = useCallback(async (center: LatLng) => {
    try {
      const [svc, feat] = await Promise.all([
        getNearbyServiceLocations(supabase, center, SEARCH_RADIUS_METERS),
        getNearbyFeatures(supabase, center, SEARCH_RADIUS_METERS),
      ]);
      setServices(svc.status === "ok" ? svc.data : []);
      setFeatures(feat.status === "ok" ? feat.data : []);
    } catch {
      setErrorMessage("دریافت اطلاعات نقشه با خطا مواجه شد.");
    }
  }, []);

  // Map init runs once; style/attribution come only from TilesPort so this
  // component never depends on a specific tile provider's payload shape.
  useEffect(() => {
    if (!containerRef.current || mapRef.current || tileStyle.status !== "ok") return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: tileStyle.data.styleUrl,
      center: [TEHRAN_CENTER.lng, TEHRAN_CENTER.lat],
      zoom: 11,
      attributionControl: { compact: true, customAttribution: tileStyle.data.attribution },
    });
    mapRef.current = map;
    map.on("load", () => setStatus("ready"));
    map.on("error", () => setErrorMessage("بارگذاری نقشه با مشکل مواجه شد."));
    loadNearby(TEHRAN_CENTER);
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Click-to-report / click-to-route: re-bound whenever mode or the
  // in-progress route selection changes, so the handler always closes over
  // current values instead of stale ones.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handleClick = (e: MapMouseEvent) => {
      const point: LatLng = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      if (mode === "report") {
        setReportDraft({ point, description: "" });
      } else if (mode === "route") {
        setRoutePoints((prev) => {
          const next = prev.length >= 2 ? [point] : [...prev, point];
          if (next.length === 2) { setRouteResult(null); setRouteLoading(true); }
          return next;
        });
      }
    };
    map.on("click", handleClick);
    return () => { map.off("click", handleClick); };
  }, [mode, routePoints.length]);

  // Fetch the route preview once both origin and destination are picked.
  // routeResult is only ever read while routePoints.length === 2 (see the
  // render below), so it's left stale rather than reset here -- resetting
  // it is handled at the selection sites (mode toggle, re-pick) instead.
  useEffect(() => {
    if (routePoints.length !== 2) return;
    let cancelled = false;
    previewRoute(routePoints[0], routePoints[1])
      .then((res) => { if (!cancelled) setRouteResult(res.status === "ok" ? res.data : null); })
      .catch(() => { if (!cancelled) setErrorMessage("محاسبه مسیر با خطا مواجه شد."); })
      .finally(() => { if (!cancelled) setRouteLoading(false); });
    return () => { cancelled = true; };
  }, [routePoints]);

  // Debounced place search (OSM Nominatim via /api/map/geocode). Loading
  // state is set in handleSearchChange (a plain event handler) rather than
  // here, so nothing calls setState synchronously at the top of an effect.
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) return;
    const timer = setTimeout(() => {
      searchPlaces(q)
        .then((res) => setSearchResults(res.status === "ok" ? res.data : []))
        .catch(() => setSearchResults([]))
        .finally(() => setSearchLoading(false));
    }, 450);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Draw/update the route line as a GeoJSON source+layer once the map is ready.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    const data: GeoJSON.Feature = {
      type: "Feature",
      properties: {},
      geometry: routeResult?.geometry ?? { type: "LineString", coordinates: [] },
    };
    const source = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else {
      map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data });
      map.addLayer({
        id: ROUTE_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        paint: { "line-color": "#39FF14", "line-width": 4, "line-dasharray": [2, 1] },
      });
    }
  }, [routeResult, status]);

  // Re-render markers whenever the visible data or category filter changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    for (const svc of services) {
      const el = document.createElement("div");
      el.style.cssText = "width:16px;height:16px;border-radius:50%;background:#39FF14;border:2px solid #0a0a0a;box-shadow:0 0 6px #39FF14;";
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([svc.lng, svc.lat])
        .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(
          `<div style="direction:rtl;font-family:sans-serif"><strong>${escapeHtml(svc.name)}</strong><br/>سرویس ثبت‌شده در ماشین من${svc.city ? `<br/>${escapeHtml(svc.city)}` : ""}</div>`,
        ))
        .addTo(map);
      markersRef.current.push(marker);
    }

    routePoints.forEach((p, i) => {
      const el = document.createElement("div");
      el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${i === 0 ? "#39FF14" : "#ff3939"};border:2px solid #0a0a0a;`;
      markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map));
    });

    for (const feature of features) {
      if (!activeCategoryIds.has(feature.categoryId)) continue;
      const cat = categoryById[feature.categoryId];
      const el = document.createElement("div");
      el.style.cssText = "width:12px;height:12px;border-radius:50%;background:#ffffff;border:2px solid #39FF14;";
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([feature.lng, feature.lat])
        .setPopup(new maplibregl.Popup({ offset: 10 }).setHTML(
          `<div style="direction:rtl;font-family:sans-serif"><strong>${escapeHtml(feature.nameFa)}</strong><br/>${escapeHtml(cat?.name_fa ?? "")}</div>`,
        ))
        .addTo(map);
      markersRef.current.push(marker);
    }
  }, [services, features, activeCategoryIds, categoryById, routePoints]);

  const handleLocateMe = useCallback(() => {
    if (!navigator.geolocation) {
      setErrorMessage("مرورگر شما از موقعیت‌یابی پشتیبانی نمی‌کند.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const center: LatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        mapRef.current?.flyTo({ center: [center.lng, center.lat], zoom: 13 });
        loadNearby(center);
      },
      () => setErrorMessage("دسترسی به موقعیت مکانی رد شد یا در دسترس نیست."),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }, [loadNearby]);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (value.trim().length < 2) { setSearchResults([]); setSearchLoading(false); }
    else setSearchLoading(true);
  };

  const selectSearchResult = (result: GeocodeResult) => {
    const center: LatLng = { lat: result.lat, lng: result.lng };
    mapRef.current?.flyTo({ center: [center.lng, center.lat], zoom: 14 });
    loadNearby(center);
    setSearchQuery(result.label);
    setSearchResults([]);
  };

  const toggleCategory = (id: number) => {
    setActiveCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const submitReport = async () => {
    if (!reportDraft) return;
    setReportStatus("sending");
    try {
      await submitCommunityReport(supabase, reportDraft.point, reportDraft.description || null, null);
      setReportStatus("sent");
      setTimeout(() => { setReportDraft(null); setMode("none"); setReportStatus("idle"); }, 1500);
    } catch {
      setReportStatus("error");
    }
  };

  return (
    <div className="relative h-[calc(100vh-88px)] w-full">
      <div ref={containerRef} className="absolute inset-0" />

      {tileStyle.status === "capability_disabled" ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-neutral-950/90 p-6 text-center text-gray-300">
          سرویس نقشه در حال حاضر در دسترس نیست.
        </div>
      ) : status === "loading" && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-neutral-950/80 text-[#39FF14]">
          در حال بارگذاری نقشه...
        </div>
      )}

      {errorMessage && (
        <div className="absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-full border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {errorMessage}
        </div>
      )}

      <div className="absolute left-1/2 top-4 z-30 w-[min(320px,70vw)] -translate-x-1/2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="جستجوی مکان..."
          dir="rtl"
          className="w-full rounded-full border border-[#39FF14]/30 bg-neutral-950/90 px-4 py-2 text-sm text-gray-100 shadow backdrop-blur outline-none focus:border-[#39FF14]"
        />
        {(searchLoading || searchResults.length > 0) && (
          <div className="mt-1 max-h-60 overflow-y-auto rounded-xl border border-[#39FF14]/20 bg-neutral-950/95 text-sm text-gray-200 shadow-xl backdrop-blur">
            {searchLoading ? (
              <p className="p-3 text-gray-400">در حال جستجو...</p>
            ) : (
              searchResults.map((r, i) => (
                <button
                  key={i}
                  onClick={() => selectSearchResult(r)}
                  className="block w-full truncate px-3 py-2 text-right hover:bg-[#39FF14]/10"
                >
                  {r.label}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="absolute right-4 top-4 z-30 flex flex-col gap-2">
        <button
          onClick={handleLocateMe}
          className="rounded-full border border-[#39FF14]/40 bg-neutral-950/80 px-4 py-2 text-sm font-bold text-[#39FF14] shadow backdrop-blur hover:bg-[#39FF14]/10"
        >
          موقعیت من
        </button>
        <button
          onClick={() => {
            setMode((m) => (m === "report" ? "none" : "report"));
            setReportDraft(null);
            setRoutePoints([]);
          }}
          className={`rounded-full border px-4 py-2 text-sm font-bold shadow backdrop-blur ${
            mode === "report" ? "border-[#39FF14] bg-[#39FF14]/20 text-[#39FF14]" : "border-gray-600 bg-neutral-950/80 text-gray-300"
          }`}
        >
          {mode === "report" ? "لغو گزارش" : "گزارش روی نقشه"}
        </button>
        <button
          onClick={() => {
            setMode((m) => (m === "route" ? "none" : "route"));
            setRoutePoints([]);
            setReportDraft(null);
          }}
          className={`rounded-full border px-4 py-2 text-sm font-bold shadow backdrop-blur ${
            mode === "route" ? "border-[#39FF14] bg-[#39FF14]/20 text-[#39FF14]" : "border-gray-600 bg-neutral-950/80 text-gray-300"
          }`}
        >
          {mode === "route" ? "لغو مسیر" : "پیش‌نمایش مسیر"}
        </button>
      </div>

      {mode === "route" && (
        <div className="absolute bottom-4 left-1/2 z-30 w-[min(360px,90vw)] -translate-x-1/2 rounded-xl border border-[#39FF14]/30 bg-neutral-950/95 p-4 text-sm text-gray-200 shadow-xl backdrop-blur">
          {routePoints.length < 2 ? (
            <p>{routePoints.length === 0 ? "مبدا را روی نقشه انتخاب کنید." : "مقصد را روی نقشه انتخاب کنید."}</p>
          ) : routeLoading ? (
            <p className="text-[#39FF14]">در حال محاسبه مسیر...</p>
          ) : routeResult ? (
            <>
              <p className="font-bold text-[#39FF14]">
                {(routeResult.distanceMeters / 1000).toLocaleString("fa-IR", { maximumFractionDigits: 1 })} کیلومتر
                {" · "}
                {Math.round(routeResult.durationSeconds / 60).toLocaleString("fa-IR")} دقیقه
              </p>
              {routeResult.isEstimate && (
                <p className="mt-1 text-xs text-gray-400">
                  تخمین مسیر مستقیم (نسخه آزمایشی فاز ۱) -- بر اساس شبکه واقعی جاده‌ها نیست.
                </p>
              )}
              <button onClick={() => setRoutePoints([])} className="mt-2 w-full rounded-lg border border-gray-600 px-3 py-2 text-gray-300">
                انتخاب دوباره
              </button>
            </>
          ) : (
            <p className="text-red-400">محاسبه مسیر با خطا مواجه شد.</p>
          )}
        </div>
      )}

      <div className="absolute left-4 top-4 z-30 max-h-[70vh] overflow-y-auto rounded-xl border border-[#39FF14]/20 bg-neutral-950/80 p-3 text-sm text-gray-200 backdrop-blur">
        <p className="mb-2 font-bold text-[#39FF14]">دسته‌بندی‌ها</p>
        <div className="flex flex-col gap-1.5">
          {categories.map((c) => (
            <label key={c.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={activeCategoryIds.has(c.id)}
                onChange={() => toggleCategory(c.id)}
                className="accent-[#39FF14]"
              />
              {c.name_fa}
            </label>
          ))}
        </div>
      </div>

      {reportDraft && (
        <div className="absolute bottom-4 left-1/2 z-30 w-[min(360px,90vw)] -translate-x-1/2 rounded-xl border border-[#39FF14]/30 bg-neutral-950/95 p-4 text-sm text-gray-200 shadow-xl backdrop-blur">
          {reportStatus === "sent" ? (
            <p className="text-[#39FF14]">گزارش شما ثبت شد و برای بررسی ارسال شد.</p>
          ) : (
            <>
              <p className="mb-2 font-bold text-[#39FF14]">گزارش نقطه روی نقشه</p>
              <textarea
                value={reportDraft.description}
                onChange={(e) => setReportDraft({ ...reportDraft, description: e.target.value })}
                maxLength={1000}
                rows={3}
                placeholder="توضیح کوتاه (اختیاری)"
                className="mb-2 w-full rounded-lg border border-gray-700 bg-neutral-900 p-2 text-gray-100 outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={submitReport}
                  disabled={reportStatus === "sending"}
                  className="flex-1 rounded-lg bg-[#39FF14] px-3 py-2 font-bold text-neutral-950 disabled:opacity-50"
                >
                  {reportStatus === "sending" ? "در حال ارسال..." : "ارسال گزارش"}
                </button>
                <button onClick={() => setReportDraft(null)} className="rounded-lg border border-gray-600 px-3 py-2 text-gray-300">
                  انصراف
                </button>
              </div>
              {reportStatus === "error" && <p className="mt-2 text-red-400">ارسال گزارش ناموفق بود. دوباره تلاش کنید.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
