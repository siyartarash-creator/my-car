// npm run test:map -- runs every Map-domain test file (Phase 1 through
// the Phase 3 independent-audit corrective patch) and reports a clear
// pass/fail summary. Phase 3 audit item 8: these files existed before
// but were only ever invoked manually/individually -- nothing committed
// ran the full set together. Add a new tests/map-*.mjs file to the list
// below when it's created; this script deliberately does not glob for
// them, so a new file is a visible, reviewable addition here.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

const TEST_FILES = [
  // Phase 1: foundation, ingestion, routing (straight-line + provider swap)
  "tests/map-foundation.mjs",
  "tests/map-ingestion.mjs",
  "tests/map-routing.mjs",
  // Phase 2: geocoding/rate-limit/circuit-breaker, road-event lifecycle, infrastructure
  "tests/map-geocode-route.mjs",
  "tests/map-phase2-lifecycle.mjs",
  "tests/map-phase3-part2.mjs",
  // Phase 3 Part 3: location sharing, navigation + service network + ads
  "tests/map-phase3-part3-location-share.mjs",
  "tests/map-phase3-part3-navigation.mjs",
  // Phase 3 Part 4: AI tool surface + offline cache, indexing + rate limits
  "tests/map-phase3-part4-ai-tools.mjs",
  "tests/map-phase3-part4-hardening.mjs",
  // Phase 3 independent audit corrective patch: truck corridor + road-event
  // honesty, retention/deletion + atomic rate-limit concurrency
  "tests/map-phase3-audit-corrective.mjs",
  "tests/map-phase3-audit-corrective-db.mjs",
  // Phase 3 final audit: automatic cleanup scheduling + delete-failure UI honesty
  "tests/map-phase3-final-audit.mjs",
];

const results = [];
for (const file of TEST_FILES) {
  const absPath = path.join(root, file);
  const start = Date.now();
  const proc = spawnSync(process.execPath, [absPath], { cwd: root, encoding: "utf8" });
  const durationMs = Date.now() - start;
  const passed = proc.status === 0;
  results.push({ file, passed, durationMs, stdout: proc.stdout?.trim() ?? "", stderr: proc.stderr?.trim() ?? "" });
  console.log(`${passed ? "PASS" : "FAIL"}  ${file}  (${durationMs}ms)`);
  if (passed) {
    if (proc.stdout?.trim()) console.log(`      ${proc.stdout.trim()}`);
  } else {
    console.log(`      ${proc.stderr.trim() || proc.stdout.trim() || "(no output)"}`);
  }
}

const failed = results.filter((r) => !r.passed);
console.log("");
console.log(`${results.length - failed.length}/${results.length} Map test files passed.`);
if (failed.length > 0) {
  console.log(`Failed: ${failed.map((r) => r.file).join(", ")}`);
  process.exitCode = 1;
}
