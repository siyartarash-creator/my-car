// Provider ports: the only boundary through which Map code may depend on
// an external map/routing/weather provider. UI code and AI contracts call
// these interfaces, never a provider SDK or payload shape directly, so a
// provider can be swapped (Provider A -> Provider B -> self-hosted) without
// touching the canonical schema, the UI, or the AI-facing contracts.
import type { CapabilityResult, LatLng } from "./types";

export type TileStyle = {
  // A MapLibre style URL or inline style object. Kept opaque here so the
  // UI doesn't need to know which provider produced it.
  styleUrl: string;
  attribution: string;
};

export interface TilesPort {
  getStyle(): CapabilityResult<TileStyle>;
}

export type RouteStep = { instruction: string; distanceMeters: number };
export type RoutePreview = {
  distanceMeters: number;
  durationSeconds: number;
  // GeoJSON order: [lng, lat] -- this is the one place this module uses
  // lng-first, matching the GeoJSON LineString spec.
  geometry: { type: "LineString"; coordinates: [number, number][] };
  steps: RouteStep[];
  isEstimate: boolean; // true until a real road-aware provider is activated
};

export interface RoutingPort {
  previewRoute(origin: LatLng, destination: LatLng): Promise<CapabilityResult<RoutePreview>>;
}

export type GeocodeResult = { label: string; lat: number; lng: number };
export interface GeocodingPort {
  search(query: string): Promise<CapabilityResult<GeocodeResult[]>>;
}

export type TrafficSegment = { lat: number; lng: number; level: "free" | "moderate" | "heavy" };
export interface TrafficPort {
  getSegments(bbox: [LatLng, LatLng]): Promise<CapabilityResult<TrafficSegment[]>>;
}

export type WeatherSnapshot = { tempC: number; condition: string };
export interface WeatherPort {
  getCurrent(point: LatLng): Promise<CapabilityResult<WeatherSnapshot>>;
}

// Read vs. write tools stay separated at the port level too: every port
// above is read-only by construction (no port here ever writes canonical
// data). Community submissions go through the submitCommunityReport
// contract in ai-contracts.ts, which calls a security-definer RPC, never a
// provider port.
