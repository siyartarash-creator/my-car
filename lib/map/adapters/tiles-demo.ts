import { isCapabilityEnabled } from "../capabilities";
import type { CapabilityResult } from "../types";
import type { TilesPort, TileStyle } from "../ports";
import { disabled } from "../types";

// $0 provider: OSM-compatible raster tiles via MapLibre's demo style. This
// is the first of possibly several TilesPort implementations -- swapping
// it for a paid vector provider later means adding another file here, not
// touching the Map UI or the canonical schema.
export class DemoTilesAdapter implements TilesPort {
  getStyle(): CapabilityResult<TileStyle> {
    if (!isCapabilityEnabled("tiles")) return disabled("tiles", "Tiles capability is disabled");
    return {
      status: "ok",
      data: {
        styleUrl: "https://demotiles.maplibre.org/style.json",
        attribution: "© MapLibre, © OpenStreetMap contributors",
      },
    };
  }
}
