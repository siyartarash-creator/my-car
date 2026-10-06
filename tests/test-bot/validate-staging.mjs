const required = [
  "TEST_BOT_BASE_URL",
  "TEST_BOT_ALLOWED_HOST",
  "TEST_BOT_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "TEST_BOT_STAGING_ACK",
  "TEST_BOT_OWNER_MOBILE",
  "TEST_BOT_OWNER_PASSWORD",
  "TEST_BOT_SELLER_MOBILE",
  "TEST_BOT_SELLER_PASSWORD",
  "TEST_BOT_SERVICE_MOBILE",
  "TEST_BOT_SERVICE_PASSWORD",
  "TEST_BOT_RESCUER_MOBILE",
  "TEST_BOT_RESCUER_PASSWORD",
];

const STAGING_APP_ORIGIN = "https://dulcet-starlight-33ce57.netlify.app";
const STAGING_SUPABASE_ORIGIN = "https://hhkwntnbycpbypsaqvrc.supabase.co";
const PRODUCTION_SUPABASE_REF = "peztuerebqkfrqlmxfdm";

const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`STAGING BLOCKED: missing ${missing.join(", ")}`);
  process.exit(2);
}

let url;
let supabaseUrl;
try {
  url = new URL(process.env.TEST_BOT_BASE_URL);
  supabaseUrl = new URL(process.env.TEST_BOT_SUPABASE_URL);
} catch {
  console.error("STAGING BLOCKED: application or Supabase URL is invalid");
  process.exit(2);
}

if (process.env.TEST_BOT_TARGET !== "staging") {
  console.error("STAGING BLOCKED: TEST_BOT_TARGET must equal staging");
  process.exit(2);
}
if (process.env.TEST_BOT_STAGING_ACK !== "STAGING_ONLY") {
  console.error("STAGING BLOCKED: TEST_BOT_STAGING_ACK must equal STAGING_ONLY");
  process.exit(2);
}
if (url.origin !== STAGING_APP_ORIGIN || url.pathname !== "/" || url.search || url.hash) {
  console.error("STAGING BLOCKED: application URL is not the exact approved staging origin");
  process.exit(2);
}
if (url.hostname !== process.env.TEST_BOT_ALLOWED_HOST) {
  console.error("STAGING BLOCKED: TEST_BOT_ALLOWED_HOST must exactly match the target hostname");
  process.exit(2);
}
if (
  supabaseUrl.origin !== STAGING_SUPABASE_ORIGIN ||
  supabaseUrl.pathname !== "/" ||
  supabaseUrl.search ||
  supabaseUrl.hash ||
  supabaseUrl.hostname.includes(PRODUCTION_SUPABASE_REF)
) {
  console.error("STAGING BLOCKED: Supabase target is not the exact approved staging project");
  process.exit(2);
}

console.log(`STAGING SAFE: app=${url.hostname} supabase_ref=hhkwntnbycpbypsaqvrc production_ref=DENIED`);
