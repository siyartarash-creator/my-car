import { createClient } from "@supabase/supabase-js";

const STAGING_ORIGIN = "https://hhkwntnbycpbypsaqvrc.supabase.co";
const PRODUCTION_REF = "peztuerebqkfrqlmxfdm";
const url = process.env.TEST_BOT_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) throw new Error("staging Supabase configuration is missing");
const parsed = new URL(url);
if (parsed.origin !== STAGING_ORIGIN || parsed.pathname !== "/" || parsed.hostname.includes(PRODUCTION_REF)) {
  throw new Error("refusing authenticated security tests outside staging");
}

const roles = ["owner", "seller", "service", "rescuer"];
const clients = new Map();
let passed = 0;
const check = (condition, name) => {
  if (!condition) throw new Error(`FAIL: ${name}`);
  passed += 1;
  console.log(`[PASS] ${name}`);
};

for (const role of roles) {
  const prefix = `TEST_BOT_${role.toUpperCase()}`;
  const mobile = process.env[`${prefix}_MOBILE`];
  const password = process.env[`${prefix}_PASSWORD`];
  if (!mobile || !password) throw new Error(`${role} fixture credentials are missing`);
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email: `${mobile}@mycar.local`, password });
  check(!error && Boolean(data.user), `${role} can authenticate`);
  const { data: profile, error: profileError } = await client
    .from("profiles").select("id,user_type,is_admin,about").eq("id", data.user.id).single();
  check(!profileError && profile.user_type === role && profile.is_admin === false, `${role} fixture has the exact non-admin role`);
  clients.set(role, { client, user: data.user, profile });
}

check(new Set([...clients.values()].map(({ user }) => user.id)).size === roles.length, "sessions are isolated across four identities");

const owner = clients.get("owner");
const seller = clients.get("seller");
const rescuer = clients.get("rescuer");
const originalAbout = owner.profile.about;
const marker = `TEST-ONLY ${Date.now()}`;
const { error: ownUpdateError } = await owner.client.from("profiles").update({ about: marker }).eq("id", owner.user.id);
check(!ownUpdateError, "owner can update an allowed Profile field");
const { data: ownUpdated } = await owner.client.from("profiles").select("about").eq("id", owner.user.id).single();
check(ownUpdated?.about === marker, "allowed Profile update is visible to its owner");
await owner.client.from("profiles").update({ about: originalAbout }).eq("id", owner.user.id);

const { data: leakedProfile, error: idorReadError } = await owner.client
  .from("profiles").select("id").eq("id", seller.user.id);
check(!idorReadError && leakedProfile.length === 0, "cross-role Profile IDOR read returns no row");
const { error: idorWriteError } = await owner.client
  .from("profiles").update({ about: marker }).eq("id", seller.user.id);
check(!idorWriteError, "cross-role Profile write is safely filtered by RLS");
const { data: sellerAfterIdor } = await seller.client.from("profiles").select("about").eq("id", seller.user.id).single();
check(sellerAfterIdor?.about !== marker, "cross-role Profile IDOR cannot mutate the target");

const { error: roleEscalation } = await owner.client.from("profiles").update({ user_type: "seller" }).eq("id", owner.user.id);
check(Boolean(roleEscalation), "user_type escalation is denied");
const { error: adminEscalation } = await owner.client.from("profiles").update({ is_admin: true }).eq("id", owner.user.id);
check(Boolean(adminEscalation), "admin escalation is denied");

const { error: malformedLocation } = await rescuer.client.rpc("create_location_share", {
  p_lat: 999, p_lng: 51.4, p_context: "roadside_breakdown", p_ttl_minutes: 10,
});
check(Boolean(malformedLocation), "rescuer malformed location input is denied");
const { error: ownerPublish } = await owner.client.rpc("publish_service_location", {
  p_lat: 35.7, p_lng: 51.4, p_is_published: true,
});
check(Boolean(ownerPublish), "owner cannot publish a service/mechanic location");

await owner.client.auth.signOut();
const { data: ownerAfterLogout } = await owner.client.auth.getUser();
check(!ownerAfterLogout.user, "logout clears the owner session");
const { data: sellerStillActive } = await seller.client.auth.getUser();
check(sellerStillActive.user?.id === seller.user.id, "logout does not leak across isolated sessions");

for (const { client } of clients.values()) await client.auth.signOut();
console.log(`${passed} authenticated staging security assertions passed.`);
