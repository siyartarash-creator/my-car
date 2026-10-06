import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP_ORIGIN = "https://dulcet-starlight-33ce57.netlify.app";
const STAGING_REF = "hhkwntnbycpbypsaqvrc";
const PRODUCTION_REF = "peztuerebqkfrqlmxfdm";
const SUPABASE_ORIGIN = `https://${STAGING_REF}.supabase.co`;
const sourcePath = process.env.TEST_BOT_SOURCE_ENV;
const outputPath = process.env.TEST_BOT_OUTPUT_ENV || ".env.test-bot.local";

if (!sourcePath) throw new Error("TEST_BOT_SOURCE_ENV is required");

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) out[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

const source = loadEnv(sourcePath);
const supabaseUrl = source.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = source.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !anonKey) throw new Error("staging URL or anon key is missing");
const parsed = new URL(supabaseUrl);
if (parsed.origin !== SUPABASE_ORIGIN || parsed.pathname !== "/" || parsed.hostname.includes(PRODUCTION_REF)) {
  throw new Error("refusing to bootstrap outside the exact staging Supabase project");
}

const noRedirectFetch = (input, init) => fetch(input, { ...init, redirect: "error" });
const roles = ["owner", "seller", "service", "rescuer"];
const runId = Date.now().toString(36);
const fixtures = [];

for (const role of roles) {
  const suffix = randomBytes(5).toString("hex");
  const mobile = `09${Array.from(randomBytes(9), (n) => n % 10).join("")}`;
  const password = `Tb-${randomBytes(18).toString("base64url")}!9a`;
  const email = `${mobile}@mycar.local`;
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: noRedirectFetch },
  });
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: {
        name: `TEST BOT ${role.toUpperCase()} ${runId}-${suffix}`,
        mobile,
        user_type: role,
        test_only: true,
        fixture: "persistent-test-bot",
      },
    },
  });
  if (error) throw new Error(`${role} fixture signup failed: ${error.message}`);
  if (!data.session || !data.user) throw new Error(`${role} fixture requires hosted Auth confirmation`);
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("id,user_type,is_admin")
    .eq("id", data.user.id)
    .single();
  if (profileError || profile?.user_type !== role || profile?.is_admin !== false) {
    throw new Error(`${role} profile trigger verification failed`);
  }
  fixtures.push({ role, mobile, password });
  await client.auth.signOut();
}

const lines = [
  "# Generated TEST-ONLY staging fixtures. Never commit or reuse in Production.",
  "TEST_BOT_TARGET=staging",
  "TEST_BOT_STAGING_ACK=STAGING_ONLY",
  `TEST_BOT_BASE_URL=${APP_ORIGIN}`,
  `TEST_BOT_ALLOWED_HOST=${new URL(APP_ORIGIN).hostname}`,
  `TEST_BOT_SUPABASE_URL=${SUPABASE_ORIGIN}`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`,
  ...fixtures.flatMap(({ role, mobile, password }) => {
    const prefix = `TEST_BOT_${role.toUpperCase()}`;
    return [`${prefix}_MOBILE=${mobile}`, `${prefix}_PASSWORD=${password}`];
  }),
];
writeFileSync(outputPath, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
console.log(`CREATED ${fixtures.length} persistent TEST-ONLY identities in staging; credentials saved locally and not printed.`);
