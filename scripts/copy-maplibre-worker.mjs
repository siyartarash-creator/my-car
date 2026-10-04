// maplibre-gl's web worker ships as an ES module file inside node_modules.
// Turbopack's dev worker-chunk resolution doesn't serve it correctly (the
// browser gets the Next.js 404 HTML page instead of the script, "Worker
// failed to load"), so it's copied to public/ and loaded via
// maplibregl.setWorkerUrl() with a plain static URL instead. Re-run on
// every install so it tracks whatever maplibre-gl version is installed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const distDir = path.join(root, "node_modules/maplibre-gl/dist");
const publicDir = path.join(root, "public");

// maplibre-gl-worker.mjs imports "./maplibre-gl-shared.mjs" as a relative
// sibling module -- both files must land in public/ together, or the
// worker's own import 404s against Next's catch-all route.
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  const src = path.join(distDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(publicDir, file));
    console.log(`Copied ${file} to public/`);
  } else {
    console.warn(`${file} not found in maplibre-gl/dist; skipping`);
  }
}
