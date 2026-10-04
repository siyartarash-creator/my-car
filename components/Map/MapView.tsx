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
import { getTileStyle, getNearbyFeatures, getNearbyServiceLocations, submitCommunityReport } from "@/lib/map/ai-contracts";
import type { LatLng, MapFeature, MapServiceLocation } from "@/lib/map/types";

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
  const [reportMode, setReportMode] = useState(false);
  const [reportDraft, setReportDraft] = useState<{ point: LatLng; description: string } | null>(null);
  const [reportStatus, setReportStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
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

  // Click-to-report: re-bound whenever reportMode changes, so the handler
  // always closes over the current value instead of a stale one.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handleClick = (e: MapMouseEvent) => {
      if (!reportMode) return;
      setReportDraft({ point: { lat: e.lngLat.lat, lng: e.lngLat.lng }, description: "" });
    };
    map.on("click", handleClick);
    return () => { map.off("click", handleClick); };
  }, [reportMode]);

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
  }, [services, features, activeCategoryIds, categoryById]);

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
      setTimeout(() => { setReportDraft(null); setReportMode(false); setReportStatus("idle"); }, 1500);
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

      <div className="absolute right-4 top-4 z-30 flex flex-col gap-2">
        <button
          onClick={handleLocateMe}
          className="rounded-full border border-[#39FF14]/40 bg-neutral-950/80 px-4 py-2 text-sm font-bold text-[#39FF14] shadow backdrop-blur hover:bg-[#39FF14]/10"
        >
          موقعیت من
        </button>
        <button
          onClick={() => { setReportMode((v) => !v); setReportDraft(null); }}
          className={`rounded-full border px-4 py-2 text-sm font-bold shadow backdrop-blur ${
            reportMode ? "border-[#39FF14] bg-[#39FF14]/20 text-[#39FF14]" : "border-gray-600 bg-neutral-950/80 text-gray-300"
          }`}
        >
          {reportMode ? "لغو گزارش" : "گزارش روی نقشه"}
        </button>
      </div>

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
