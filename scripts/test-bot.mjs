import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const staging = process.argv.includes("--staging");
if (staging && existsSync(".env.test-bot.local") && process.loadEnvFile) {
  process.loadEnvFile(".env.test-bot.local");
}
const outputDir = resolve("reports/test-bot");
mkdirSync(outputDir, { recursive: true });

const suites = [
  ...(staging ? [{
    id: "staging-guard",
    domain: "Staging / production safety gate",
    args: ["tests/test-bot/validate-staging.mjs"],
    env: { TEST_BOT_TARGET: "staging" },
  }, {
    id: "staging-auth-security",
    domain: "Staging / authenticated roles and security",
    args: ["tests/test-bot/staging-security.mjs"],
    env: { TEST_BOT_TARGET: "staging" },
  }] : []),
  { id: "quality", domain: "Platform / type safety", args: ["node_modules/typescript/bin/tsc", "--noEmit", "--incremental", "false"] },
  { id: "database-security", domain: "Store / RLS / permissions / idempotency", args: ["tests/database-security.mjs"] },
  { id: "write-boundary", domain: "Store / malformed write boundary", args: ["tests/write-boundary.mjs"] },
  { id: "map-foundation", domain: "Rescue / service discovery role boundary", args: ["tests/map-foundation.mjs"] },
  { id: "map-ingestion", domain: "Map / malformed ingestion", args: ["tests/map-ingestion.mjs"] },
  { id: "map-routing", domain: "Map / provider-safe routing", args: ["tests/map-routing.mjs"] },
  { id: "map-lifecycle", domain: "Map / lifecycle and expiry", args: ["tests/map-phase2-lifecycle.mjs"] },
  { id: "map-geocode", domain: "Map / geocode boundary", args: ["tests/map-geocode-route.mjs"] },
  { id: "profile-validation", domain: "Profile / malformed input", args: ["tests/profile-validation.mjs"] },
  { id: "profile-completeness", domain: "Profile / role fixtures", args: ["tests/profile-completeness.mjs"] },
  { id: "seller-identity", domain: "Store Manager / role boundary", args: ["tests/seller-identity.mjs"] },
  { id: "admin-permissions", domain: "Admin / permission boundary", args: ["tests/admin-local-functional.mjs"] },
  { id: "roadside-share", domain: "Rescue / safe location handoff", args: ["tests/map-phase3-part3-location-share.mjs"] },
  { id: "roadside-hardening", domain: "Rescue / malformed and expiry", args: ["tests/map-phase3-part4-hardening.mjs"] },
  {
    id: staging ? "browser-staging" : "browser-local",
    domain: staging ? "Staging role journeys" : "Browser / malformed / double-click",
    args: ["node_modules/@playwright/test/cli.js", "test", staging ? "--grep" : "--grep-invert", "@staging"],
    env: staging ? { TEST_BOT_TARGET: "staging" } : {},
  },
];

const startedAt = new Date();
const results = [];
for (const suite of suites) {
  const start = Date.now();
  console.log(`\n[RUN] ${suite.domain}`);
  const run = spawnSync(process.execPath, suite.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...suite.env },
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  const result = {
    id: suite.id,
    domain: suite.domain,
    status: run.status === 0 ? "PASS" : "FAIL",
    exitCode: run.status,
    durationMs: Date.now() - start,
    summary: [
      ...(run.stdout || "").trim().split(/\r?\n/).slice(-3),
      ...(run.stderr || "").trim().split(/\r?\n/).slice(-2),
      run.error?.message,
    ].filter(Boolean),
  };
  results.push(result);
  if (suite.id === "staging-guard" && result.status === "FAIL") break;
}

const failed = results.filter((result) => result.status === "FAIL").length;
const reportStem = staging ? "report-staging" : "report-local";
const report = {
  name: "MY CAR Test Bot",
  target: staging ? "staging" : "local-mock-safe",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status: failed ? "FAIL" : "PASS",
  totals: { pass: results.length - failed, fail: failed },
  boundaries: {
    production: "DENIED",
    realPayments: "OUT_OF_SCOPE",
    finance: "OUT_OF_SCOPE",
    serviceRoleBypass: "DENIED",
  },
  coverageLimitations: [
    "Rescue dispatch/ticketing is not implemented in this baseline; only Profile, discovery and safe location handoff contracts are tested.",
    "Mechanic job lifecycle is not implemented in this baseline; service-role Profile and boundary behavior are tested.",
    staging ? "Staging journeys are non-destructive authentication, Profile and route-boundary checks." : "Authenticated staging journeys were not run in local mode.",
  ],
  results,
};

writeFileSync(resolve(outputDir, `${reportStem}.json`), `${JSON.stringify(report, null, 2)}\n`);
const rows = results.map((r) => `| ${r.status} | ${r.domain} | ${(r.durationMs / 1000).toFixed(1)}s |`).join("\n");
const markdown = `# MY CAR Test Bot — ${report.status}\n\nTarget: **${report.target}**  \nStarted: ${report.startedAt}  \nFinished: ${report.finishedAt}\n\n| Result | Scenario group | Time |\n|---|---|---:|\n${rows}\n\n## Safety boundaries\n\n- Production: DENIED\n- Finance and real payment: OUT OF SCOPE\n- Service-role bypass: DENIED\n\n## Known coverage limits\n\n${report.coverageLimitations.map((item) => `- ${item}`).join("\n")}\n`;
writeFileSync(resolve(outputDir, `${reportStem}.md`), markdown);
console.log(`\n[${report.status}] report: ${resolve(outputDir, `${reportStem}.md`)}`);
process.exit(failed ? 1 : 0);
