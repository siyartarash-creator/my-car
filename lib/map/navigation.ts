// Phase 3 Part 3: foreground live navigation. Browser Geolocation
// watchPosition only -- see live_navigation_background in capabilities.ts
// for why reliable background/locked-screen tracking is a platform
// dependency this repo (a plain Next.js web app, no Capacitor/Cordova)
// cannot honestly claim. This module has no DB/network dependency of its
// own; it only consumes a RoutePreview already produced by previewRoute().
import { haversineMeters, routeProgress } from "./geo";
import { isCapabilityEnabled } from "./capabilities";
import type { LatLng } from "./types";
import type { RoutePreview } from "./ports";

export type GpsPermissionState = "unsupported" | "prompt" | "granted" | "denied";
export type NavigationStatus = "idle" | "active" | "off_route" | "arrived" | "error";

export type NavigationState = {
  status: NavigationStatus;
  permission: GpsPermissionState;
  currentPosition: LatLng | null;
  accuracyMeters: number | null;
  // true when the OS/browser reports a fix worse than DEGRADED_ACCURACY_THRESHOLD_M
  // -- surfaced so the UI can say "GPS is weak" instead of silently trusting
  // a bad fix for off-route/arrival decisions.
  degradedGps: boolean;
  distanceTraveledMeters: number;
  distanceRemainingMeters: number;
  crossTrackMeters: number;
  // true once crossTrackMeters exceeds the off-route threshold -- a signal
  // for the caller to request a fresh previewRoute() from the current
  // position, never done automatically by this module (rerouting changes
  // the active route, which is a UI-level decision).
  needsReroute: boolean;
  errorMessage: string | null;
};

export const OFF_ROUTE_THRESHOLD_M = 100;
export const ARRIVAL_THRESHOLD_M = 30;
export const DEGRADED_ACCURACY_THRESHOLD_M = 100;

function supportsGeolocation(): boolean {
  return typeof navigator !== "undefined" && !!navigator.geolocation;
}

export class NavigationSession {
  private watchId: number | null = null;
  private readonly path: LatLng[];
  private readonly destination: LatLng;
  private readonly onUpdate: (state: NavigationState) => void;
  private state: NavigationState;

  constructor(route: RoutePreview, onUpdate: (state: NavigationState) => void) {
    this.path = route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
    this.destination = this.path[this.path.length - 1];
    this.onUpdate = onUpdate;
    this.state = {
      status: "idle",
      permission: supportsGeolocation() ? "prompt" : "unsupported",
      currentPosition: null,
      accuracyMeters: null,
      degradedGps: false,
      distanceTraveledMeters: 0,
      distanceRemainingMeters: route.distanceMeters,
      crossTrackMeters: 0,
      needsReroute: false,
      errorMessage: null,
    };
  }

  getState(): NavigationState {
    return this.state;
  }

  // Safe-failure contract: every exit path (disabled capability, no
  // browser support, permission denied, position unavailable, timeout)
  // sets a distinct status/errorMessage through onUpdate -- this never
  // throws and never leaves the caller silently stuck in "idle".
  start(): void {
    if (!isCapabilityEnabled("live_navigation_foreground")) {
      this.update({ status: "error", errorMessage: "Live navigation capability is disabled" });
      return;
    }
    if (!supportsGeolocation()) {
      this.update({ status: "error", permission: "unsupported", errorMessage: "این مرورگر از موقعیت‌یابی پشتیبانی نمی‌کند." });
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.handlePosition(pos),
      (err) => this.handleError(err),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    );
  }

  stop(): void {
    if (this.watchId != null && supportsGeolocation()) {
      navigator.geolocation.clearWatch(this.watchId);
    }
    this.watchId = null;
  }

  private handlePosition(pos: GeolocationPosition): void {
    const point: LatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    const progress = routeProgress(point, this.path);
    const degradedGps = pos.coords.accuracy != null && pos.coords.accuracy > DEGRADED_ACCURACY_THRESHOLD_M;
    const arrived = haversineMeters(point, this.destination) <= ARRIVAL_THRESHOLD_M;
    const offRoute = !arrived && progress.crossTrackMeters > OFF_ROUTE_THRESHOLD_M;
    this.update({
      status: arrived ? "arrived" : offRoute ? "off_route" : "active",
      permission: "granted",
      currentPosition: point,
      accuracyMeters: pos.coords.accuracy ?? null,
      degradedGps,
      distanceTraveledMeters: progress.distanceTraveledMeters,
      distanceRemainingMeters: progress.distanceRemainingMeters,
      crossTrackMeters: progress.crossTrackMeters,
      needsReroute: offRoute,
      errorMessage: null,
    });
  }

  private handleError(err: GeolocationPositionError): void {
    const permission: GpsPermissionState = err.code === err.PERMISSION_DENIED ? "denied" : this.state.permission;
    const errorMessage =
      err.code === err.PERMISSION_DENIED
        ? "دسترسی به موقعیت مکانی رد شد."
        : err.code === err.POSITION_UNAVAILABLE
          ? "موقعیت مکانی در دسترس نیست (سیگنال GPS ضعیف یا قطع است)."
          : "دریافت موقعیت مکانی با وقفه مواجه شد.";
    this.update({ status: "error", permission, errorMessage });
  }

  private update(patch: Partial<NavigationState>): void {
    this.state = { ...this.state, ...patch };
    this.onUpdate(this.state);
  }
}
