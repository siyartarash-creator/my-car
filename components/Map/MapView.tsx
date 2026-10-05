"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
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
import {
  getTileStyle,
  getNearbyFeatures,
  getNearbyServiceLocations,
  findRoadEvents,
  findServicesAlongRoute,
  createLocationShare,
  deleteLocationShare,
  getMyActiveLocationShares,
  previewRoute,
  searchPlaces,
  submitCommunityReport,
} from "@/lib/map/ai-contracts";
import type { LatLng, MapFeature, MapServiceLocation } from "@/lib/map/types";
import type { GeocodeResult, RoutePreview, VehicleType } from "@/lib/map/ports";
import { NavigationSession } from "@/lib/map/navigation";
import type { NavigationState } from "@/lib/map/navigation";
import { cacheSnapshot, getCachedSnapshot, areaCacheKey } from "@/lib/map/offline";

const ROUTE_SOURCE_ID = "map-route-preview";
const ROUTE_LAYER_ID = "map-route-preview-line";

type RoadEventSeverityValue = "low" | "medium" | "high" | "critical";
type RoadEventSeverityMap = Record<number, RoadEventSeverityValue | null>;

const SEVERITY_COLOR: Record<RoadEventSeverityValue, string> = {
  low: "#ffd23f",
  medium: "#ff8c00",
  high: "#ff3939",
  critical: "#8b0000",
};
const SEVERITY_FA: Record<RoadEventSeverityValue, string> = {
  low: "کم",
  medium: "متوسط",
  high: "بالا",
  critical: "بحرانی",
};

type Category = { id: number; slug: string; name_fa: string; icon: string | null };

const TEHRAN_CENTER: LatLng = { lat: 35.6997, lng: 51.338 };
const SEARCH_RADIUS_METERS = 25_000;

// No background/silent tracking anywhere in this component: Locate Me
// calls getCurrentPosition once, and live navigation's watchPosition only
// runs between an explicit "start" and "stop" click (never persisted --
// see lib/map/navigation.ts). The one thing that IS persisted is the
// roadside location share, and only on an explicit "درخواست کمک" click
// (default off, revocable, short TTL -- see createLocationShare).
export default function MapView({ categories }: { categories: Category[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const tileStyle = getTileStyle();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [services, setServices] = useState<MapServiceLocation[]>([]);
  const [features, setFeatures] = useState<MapFeature[]>([]);
  const [roadEventSeverityById, setRoadEventSeverityById] = useState<RoadEventSeverityMap>({});
  const [activeCategoryIds, setActiveCategoryIds] = useState<Set<number>>(
    () => new Set(categories.map((c) => c.id)),
  );
  const [mode, setMode] = useState<"none" | "report" | "route">("none");
  const [reportDraft, setReportDraft] = useState<{ point: LatLng; description: string } | null>(null);
  const [reportStatus, setReportStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [routePoints, setRoutePoints] = useState<LatLng[]>([]);
  const [routeVehicle, setRouteVehicle] = useState<VehicleType>("car");
  const [routeResult, setRouteResult] = useState<RoutePreview | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const categoryById = Object.fromEntries(categories.map((c) => [c.id, c]));

  // --- Phase 3 Part 3: live navigation (foreground only) -----------------
  const navSessionRef = useRef<NavigationSession | null>(null);
  const [navState, setNavState] = useState<NavigationState | null>(null);

  // --- Phase 3 Part 3: services along the active route -------------------
  const [routeServices, setRouteServices] = useState<MapServiceLocation[] | null>(null);
  const [routeServicesLoading, setRouteServicesLoading] = useState(false);

  // --- Phase 3 Part 3: roadside location handoff (opt-in, default off) ---
  const [roadsideShareId, setRoadsideShareId] = useState<number | null>(null);
  // "deleting"/"delete_error" are distinct from "sharing"/"error" (which
  // are about *starting* a share) so a failed stop never gets mistaken
  // for a failed start, or vice versa -- see handleStopRoadsideShare.
  const [roadsideStatus, setRoadsideStatus] = useState<"idle" | "sharing" | "shared" | "error" | "deleting" | "delete_error">("idle");

  // --- Phase 3 Part 4: offline cache (clearly labeled, never silent) -----
  const [offlineSnapshotAt, setOfflineSnapshotAt] = useState<string | null>(null);

  const loadNearby = useCallback(async (center: LatLng) => {
    const cacheKey = areaCacheKey(center.lat, center.lng);
    try {
      const [svc, feat, events] = await Promise.all([
        getNearbyServiceLocations(supabase, center, SEARCH_RADIUS_METERS),
        getNearbyFeatures(supabase, center, SEARCH_RADIUS_METERS),
        findRoadEvents(supabase, center, SEARCH_RADIUS_METERS),
      ]);
      const svcData = svc.status === "ok" ? svc.data : [];
      const featData = feat.status === "ok" ? feat.data : [];
      const severityById = events.status === "ok" ? Object.fromEntries(events.data.map((e) => [e.id, e.severity])) : {};
      setServices(svcData);
      setFeatures(featData);
      setRoadEventSeverityById(severityById);
      setOfflineSnapshotAt(null); // fresh data -- not offline
      cacheSnapshot(cacheKey, { services: svcData, features: featData, severityById });
    } catch {
      // Honest $0 offline layer (lib/map/offline.ts): fall back to the
      // last successful response for this area, clearly labeled as stale
      // -- never silently presented as live data.
      const cached = getCachedSnapshot<{ services: MapServiceLocation[]; features: MapFeature[]; severityById: RoadEventSeverityMap }>(cacheKey);
      if (cached) {
        setServices(cached.data.services);
        setFeatures(cached.data.features);
        setRoadEventSeverityById(cached.data.severityById);
        setOfflineSnapshotAt(cached.cachedAt);
        setErrorMessage("اتصال برقرار نشد -- نمایش داده‌های ذخیره‌شده (آفلاین).");
      } else {
        setErrorMessage("دریافت اطلاعات نقشه با خطا مواجه شد.");
      }
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
    previewRoute(supabase, { origin: routePoints[0], destination: routePoints[1], vehicle: routeVehicle })
      .then((res) => { if (!cancelled) setRouteResult(res.status === "ok" ? res.data : null); })
      .catch(() => { if (!cancelled) setErrorMessage("محاسبه مسیر با خطا مواجه شد."); })
      .finally(() => { if (!cancelled) setRouteLoading(false); });
    return () => { cancelled = true; };
  }, [routePoints, routeVehicle]);

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

    if (navState?.currentPosition) {
      const el = document.createElement("div");
      el.style.cssText = "width:16px;height:16px;border-radius:50%;background:#2196f3;border:3px solid #ffffff;box-shadow:0 0 8px #2196f3;";
      markersRef.current.push(
        new maplibregl.Marker({ element: el }).setLngLat([navState.currentPosition.lng, navState.currentPosition.lat]).addTo(map),
      );
    }

    for (const feature of features) {
      if (!activeCategoryIds.has(feature.categoryId)) continue;
      const cat = categoryById[feature.categoryId];
      const el = document.createElement("div");
      const severity = roadEventSeverityById[feature.id] ?? null;
      const isRoadEvent = cat?.slug === "road_event";
      if (isRoadEvent && severity) {
        const color = SEVERITY_COLOR[severity];
        el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #0a0a0a;box-shadow:0 0 6px ${color};`;
      } else if (isRoadEvent) {
        // Phase 3 audit fix: a road_event feature with no
        // map_road_event_details row is shown as explicitly unclassified
        // (neutral gray), never defaulted to a fabricated "low" severity.
        el.style.cssText = "width:14px;height:14px;border-radius:50%;background:#9ca3af;border:2px solid #0a0a0a;";
      } else {
        el.style.cssText = "width:12px;height:12px;border-radius:50%;background:#ffffff;border:2px solid #39FF14;";
      }
      const severityLabel = severity
        ? `<br/><span style="color:${SEVERITY_COLOR[severity]}">${SEVERITY_FA[severity]}</span>`
        : isRoadEvent
          ? `<br/><span style="color:#9ca3af">نامشخص (طبقه‌بندی‌نشده)</span>`
          : "";
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([feature.lng, feature.lat])
        .setPopup(new maplibregl.Popup({ offset: 10 }).setHTML(
          `<div style="direction:rtl;font-family:sans-serif"><strong>${escapeHtml(feature.nameFa)}</strong><br/>${escapeHtml(cat?.name_fa ?? "")}${severityLabel}</div>`,
        ))
        .addTo(map);
      markersRef.current.push(marker);
    }
  }, [services, features, activeCategoryIds, categoryById, routePoints, roadEventSeverityById, navState]);

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

  // Search runs only on explicit submission (Enter / the search button) --
  // never on keystroke/type-ahead, both to respect Nominatim's usage
  // policy (no bulk/automated-feeling query volume) and so a half-typed
  // query never fires a request.
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (value.trim().length < 2) setSearchResults([]);
  };

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (q.length < 2) { setSearchResults([]); return; }
    setSearchLoading(true);
    searchPlaces(q)
      .then((res) => setSearchResults(res.status === "ok" ? res.data : []))
      .catch(() => setSearchResults([]))
      .finally(() => setSearchLoading(false));
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

  // --- Phase 3 Part 3: live navigation ------------------------------------
  const startNavigation = useCallback(() => {
    if (!routeResult) return;
    navSessionRef.current?.stop();
    const session = new NavigationSession(routeResult, setNavState);
    navSessionRef.current = session;
    setNavState(session.getState());
    session.start();
  }, [routeResult]);

  const stopNavigation = useCallback(() => {
    navSessionRef.current?.stop();
    navSessionRef.current = null;
    setNavState(null);
  }, []);

  useEffect(() => () => { navSessionRef.current?.stop(); }, []); // stop watchPosition on unmount, never leave it running

  // --- Phase 3 Part 3: services along the active route --------------------
  const handleFindServicesAlongRoute = useCallback(async () => {
    if (!routeResult) return;
    setRouteServicesLoading(true);
    try {
      const points: LatLng[] = routeResult.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
      const res = await findServicesAlongRoute(supabase, points, 5_000);
      setRouteServices(res.status === "ok" ? res.data : []);
    } catch {
      setRouteServices([]);
    } finally {
      setRouteServicesLoading(false);
    }
  }, [routeResult]);

  // --- Phase 3: roadside location sharing (explicit opt-in only) ---------
  // Phase 3 audit fix (item 4): hydrate the caller's own active share on
  // mount, so a page reload doesn't orphan the row -- without this, a
  // share created before a refresh kept existing (and kept being
  // readable by any grantee) with no way to revoke/delete it from this
  // UI until it expired on its own.
  useEffect(() => {
    let cancelled = false;
    getMyActiveLocationShares(supabase)
      .then((shares) => {
        if (cancelled || shares.length === 0) return;
        setRoadsideShareId(shares[0].id);
        setRoadsideStatus("shared");
      })
      .catch(() => {
        /* no active share, or not signed in -- stay idle, not an error */
      });
    return () => { cancelled = true; };
  }, []);

  const handleStartRoadsideShare = useCallback(() => {
    if (!navigator.geolocation) {
      setErrorMessage("مرورگر شما از موقعیت‌یابی پشتیبانی نمی‌کند.");
      return;
    }
    setRoadsideStatus("sharing");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const id = await createLocationShare(
            supabase,
            { lat: pos.coords.latitude, lng: pos.coords.longitude },
            "roadside_breakdown",
            120,
          );
          setRoadsideShareId(id);
          setRoadsideStatus("shared");
        } catch {
          setRoadsideStatus("error");
        }
      },
      () => setRoadsideStatus("error"),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }, []);

  // Phase 3 audit fix (item 3): hard-deletes the share row (not just
  // revoke, which only ever controlled read access via RLS and left the
  // coordinates in the table) -- the UI's "stop sharing" action should
  // actually remove the data, not just hide it.
  //
  // Phase 3 final audit fix (delete-failure honesty): local state is
  // cleared ONLY after the RPC actually succeeds. The previous version
  // cleared roadsideShareId/roadsideStatus in a `finally` block, so a
  // failed delete_location_share call (network error, RLS/ownership
  // mismatch, anything) still showed the UI as "not sharing" while the
  // row -- and the real-world coordinates -- were still sitting in the
  // database. On failure the share id is kept and roadsideStatus becomes
  // "delete_error," which keeps the stop-sharing control visible and
  // clickable for a retry, with an explicit failure banner.
  const handleStopRoadsideShare = useCallback(async () => {
    if (roadsideShareId == null) return;
    setRoadsideStatus("deleting");
    try {
      await deleteLocationShare(supabase, roadsideShareId);
      setRoadsideShareId(null);
      setRoadsideStatus("idle");
    } catch {
      setRoadsideStatus("delete_error");
    }
  }, [roadsideShareId]);

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

      {offlineSnapshotAt && (
        <div className="absolute bottom-4 right-4 z-30 rounded-full border border-yellow-500/40 bg-yellow-500/10 px-3 py-1.5 text-xs text-yellow-300">
          حالت آفلاین -- داده‌های ذخیره‌شده از {new Date(offlineSnapshotAt).toLocaleString("fa-IR")}
        </div>
      )}

      <div className="absolute left-1/2 top-4 z-30 w-[min(320px,70vw)] -translate-x-1/2">
        <form onSubmit={handleSearchSubmit} className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="جستجوی مکان..."
            dir="rtl"
            className="w-full rounded-full border border-[#39FF14]/30 bg-neutral-950/90 px-4 py-2 text-sm text-gray-100 shadow backdrop-blur outline-none focus:border-[#39FF14]"
          />
          <button
            type="submit"
            aria-label="جستجو"
            className="shrink-0 rounded-full border border-[#39FF14]/30 bg-neutral-950/90 px-4 py-2 text-sm font-bold text-[#39FF14] shadow backdrop-blur hover:bg-[#39FF14]/10"
          >
            جستجو
          </button>
        </form>
        {(searchLoading || searchResults.length > 0) && (
          <div className="mt-1 overflow-hidden rounded-xl border border-[#39FF14]/20 bg-neutral-950/95 text-sm text-gray-200 shadow-xl backdrop-blur">
            <div className="max-h-60 overflow-y-auto">
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
            {!searchLoading && searchResults.length > 0 && (
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noopener noreferrer"
                className="block border-t border-[#39FF14]/10 px-3 py-1.5 text-left text-xs text-gray-500 hover:text-[#39FF14]"
              >
                نتایج جستجو از © OpenStreetMap contributors
              </a>
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
            stopNavigation();
            setRouteServices(null);
          }}
          className={`rounded-full border px-4 py-2 text-sm font-bold shadow backdrop-blur ${
            mode === "route" ? "border-[#39FF14] bg-[#39FF14]/20 text-[#39FF14]" : "border-gray-600 bg-neutral-950/80 text-gray-300"
          }`}
        >
          {mode === "route" ? "لغو مسیر" : "پیش‌نمایش مسیر"}
        </button>
        <button
          onClick={() => {
            // Phase 3 final audit fix: keyed off roadsideShareId (the real
            // source of truth for "do I have an active share"), not
            // roadsideStatus -- a failed delete leaves roadsideStatus as
            // "delete_error" while the share is still active, and this
            // button must still offer "stop sharing" (retry), not flip
            // back to "start sharing."
            if (roadsideShareId != null) handleStopRoadsideShare();
            else handleStartRoadsideShare();
          }}
          disabled={roadsideStatus === "sharing" || roadsideStatus === "deleting"}
          className={`rounded-full border px-4 py-2 text-sm font-bold shadow backdrop-blur disabled:opacity-50 ${
            roadsideShareId != null ? "border-red-500 bg-red-500/20 text-red-300" : "border-gray-600 bg-neutral-950/80 text-gray-300"
          }`}
        >
          {/* Phase 3 audit fix (item 5): this was "درخواست کمک" (request
              help), which implied a dispatch/help request gets created --
              nothing does. This only shares a location; see the banner
              below for the explicit dispatch-not-available statement. */}
          {roadsideStatus === "sharing"
            ? "در حال ارسال موقعیت..."
            : roadsideStatus === "deleting"
              ? "در حال توقف اشتراک‌گذاری..."
              : roadsideShareId != null
                ? "توقف اشتراک‌گذاری موقعیت"
                : "اشتراک‌گذاری موقعیت (خرابی)"}
        </button>
      </div>

      {roadsideStatus === "shared" && (
        <div className="absolute left-1/2 top-16 z-30 w-[min(320px,80vw)] -translate-x-1/2 rounded-xl border border-red-500/40 bg-neutral-950/95 p-3 text-xs text-red-200 shadow-xl backdrop-blur">
          <p>موقعیت شما به‌صورت موقت و قابل‌حذف ثبت شد (حداکثر ۲ ساعت). این موقعیت تا زمانی که آن را متوقف نکنید یا منقضی شود، فقط برای شما و ادمین قابل مشاهده است.</p>
          <p className="mt-1 font-bold">این یک درخواست کمک/امداد نیست -- سرویس اعزام خودکار در حال حاضر فعال نیست. برای کمک واقعی با خدمات امدادی تماس بگیرید.</p>
        </div>
      )}
      {roadsideStatus === "delete_error" && (
        <div className="absolute left-1/2 top-16 z-30 w-[min(320px,80vw)] -translate-x-1/2 rounded-xl border border-red-500/40 bg-neutral-950/95 p-3 text-xs text-red-300 shadow-xl backdrop-blur">
          <p className="font-bold">توقف اشتراک‌گذاری ناموفق بود.</p>
          <p className="mt-1">موقعیت شما همچنان به اشتراک گذاشته شده است -- این یعنی اشتراک‌گذاری متوقف نشده، نه اینکه متوقف شده. دوباره تلاش کنید.</p>
        </div>
      )}
      {roadsideStatus === "error" && (
        <div className="absolute left-1/2 top-16 z-30 w-[min(320px,80vw)] -translate-x-1/2 rounded-xl border border-red-500/40 bg-neutral-950/95 p-3 text-xs text-red-300 shadow-xl backdrop-blur">
          ثبت موقعیت ناموفق بود (دسترسی موقعیت مکانی رد شد یا در دسترس نیست).
        </div>
      )}

      {mode === "route" && (
        <div className="absolute bottom-4 left-1/2 z-30 w-[min(360px,90vw)] -translate-x-1/2 rounded-xl border border-[#39FF14]/30 bg-neutral-950/95 p-4 text-sm text-gray-200 shadow-xl backdrop-blur">
          <div className="mb-2 flex gap-1.5">
            {([
              ["car", "سبک"],
              ["motorcycle", "موتور"],
              ["truck", "کامیون"],
            ] as [VehicleType, string][]).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setRouteVehicle(v)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  routeVehicle === v ? "border-[#39FF14] bg-[#39FF14]/20 text-[#39FF14]" : "border-gray-600 text-gray-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
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
              {routeResult.routingMode === "advisory_estimate" && (
                <p className="mt-1 text-xs text-gray-400">
                  تخمین مسیر مستقیم (نسخه آزمایشی) -- بر اساس شبکه واقعی جاده‌ها نیست.
                </p>
              )}
              {routeVehicle === "truck" && routeResult.restrictionWarnings.length === 0 && (
                <p className="mt-1 text-xs text-gray-500">
                  محدودیت تاییدشده‌ای در نزدیکی این مسیر ثبت نشده (این مسیر بر اساس محدودیت‌ها تنظیم نمی‌شود).
                </p>
              )}
              {routeVehicle === "truck" && routeResult.restrictionWarnings.length > 0 && (
                <div className="mt-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs text-yellow-300">
                  <p className="font-bold">هشدار (فقط اطلاع‌رسانی، مسیر بر اساس آن تغییر نمی‌کند):</p>
                  {routeResult.restrictionWarnings.map((w, i) => (
                    <p key={i} className={w.severity === "exceeds_profile" ? "font-bold text-red-400" : undefined}>
                      {w.severity === "exceeds_profile" ? "⚠ " : ""}
                      {w.restrictionType}
                      {w.maxValue != null ? ` ≤ ${w.maxValue}${w.unit ?? ""}` : ""}
                      {w.note ? ` — ${w.note}` : ""}
                      {w.severity === "unspecified" ? " (برای مقایسه، ابعاد کامیون مشخص نشده)" : ""}
                    </p>
                  ))}
                </div>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => { setRoutePoints([]); stopNavigation(); setRouteServices(null); }}
                  className="flex-1 rounded-lg border border-gray-600 px-3 py-2 text-gray-300"
                >
                  انتخاب دوباره
                </button>
                {!navState ? (
                  <button onClick={startNavigation} className="flex-1 rounded-lg bg-[#39FF14] px-3 py-2 font-bold text-neutral-950">
                    شروع ناوبری
                  </button>
                ) : (
                  <button onClick={stopNavigation} className="flex-1 rounded-lg border border-red-500 px-3 py-2 text-red-300">
                    پایان ناوبری
                  </button>
                )}
              </div>

              <button
                onClick={handleFindServicesAlongRoute}
                disabled={routeServicesLoading}
                className="mt-2 w-full rounded-lg border border-[#39FF14]/30 px-3 py-2 text-xs text-[#39FF14] disabled:opacity-50"
              >
                {routeServicesLoading ? "در حال جستجوی خدمات..." : "خدمات ثبت‌شده نزدیک مسیر"}
              </button>
              {routeServices && (
                <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-gray-700 bg-neutral-900/60 p-2 text-xs text-gray-300">
                  {routeServices.length === 0 ? (
                    <p className="text-gray-500">سرویس ثبت‌شده‌ای نزدیک این مسیر یافت نشد.</p>
                  ) : (
                    routeServices.map((s) => (
                      <p key={s.id}>
                        {s.name} <span className="text-gray-500">({s.userType === "rescuer" ? "امداد" : "سرویس"}{s.city ? ` — ${s.city}` : ""})</span>
                      </p>
                    ))
                  )}
                </div>
              )}

              {navState && (
                <div className="mt-2 rounded-lg border border-[#39FF14]/30 bg-neutral-900/70 p-2 text-xs">
                  {navState.status === "error" ? (
                    <p className="text-red-400">{navState.errorMessage}</p>
                  ) : navState.status === "arrived" ? (
                    <p className="font-bold text-[#39FF14]">به مقصد رسیدید.</p>
                  ) : (
                    <>
                      <p className={navState.status === "off_route" ? "font-bold text-yellow-400" : "text-gray-300"}>
                        {navState.status === "off_route" ? "⚠ خارج از مسیر — نیاز به مسیر جدید" : "در حال حرکت روی مسیر"}
                      </p>
                      <p className="text-gray-400">
                        باقی‌مانده: {(navState.distanceRemainingMeters / 1000).toLocaleString("fa-IR", { maximumFractionDigits: 1 })} کیلومتر
                      </p>
                      {navState.degradedGps && <p className="text-yellow-500">سیگنال GPS ضعیف است.</p>}
                    </>
                  )}
                  {navState.permission === "denied" && <p className="mt-1 text-red-400">دسترسی به موقعیت مکانی رد شد.</p>}
                  {navState.permission === "unsupported" && <p className="mt-1 text-red-400">این مرورگر از موقعیت‌یابی پشتیبانی نمی‌کند.</p>}
                </div>
              )}
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

        {/* Road-event severity legend: markers are only ever colored from
            real map_road_event_details rows (see findRoadEvents), never a
            hard-coded default -- a category with no road_event features
            nearby simply shows no colored markers. */}
        {categories.some((c) => c.slug === "road_event") && (
          <div className="mt-3 border-t border-[#39FF14]/10 pt-2">
            <p className="mb-1 text-xs font-bold text-gray-400">شدت رویداد جاده‌ای</p>
            <div className="flex flex-col gap-1 text-xs text-gray-300">
              {(["low", "medium", "high", "critical"] as const).map((s) => (
                <div key={s} className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ background: SEVERITY_COLOR[s] }} />
                  {SEVERITY_FA[s]}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Honest capability state: traffic/weather have a complete
            provider-neutral contract (TrafficPort/WeatherPort,
            get_traffic_conditions/get_route_weather) but no $0 provider is
            activated -- shown here instead of silently omitted, so the UI
            never implies they work. */}
        <div className="mt-3 border-t border-[#39FF14]/10 pt-2 text-xs text-gray-500">
          <p>ترافیک زنده: غیرفعال (بدون سرویس‌دهنده رایگان تاییدشده)</p>
          <p>آب‌وهوای مسیر: غیرفعال (بدون سرویس‌دهنده رایگان تاییدشده)</p>
          <p>ناوبری در پس‌زمینه/صفحه قفل: غیرفعال (نیازمند اپلیکیشن بومی)</p>
          <p>تبلیغات: غیرفعال (بدون زیرساخت تجاری کسب‌وکارهای ثبت‌شده)</p>
          <p>کاشی‌های آفلاین/ناوبری بدون اینترنت: غیرفعال (نیازمند زیرساخت یا اپلیکیشن بومی)</p>
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
