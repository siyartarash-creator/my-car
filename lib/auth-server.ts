import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";

export async function requireRole(role: "admin" | "seller") {
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) redirect("/login");
  const { data: profile } = await client.from("profiles").select("is_admin,user_type").eq("id", user.id).single();
  if (!profile || (role === "admin" ? profile.is_admin !== true : profile.user_type !== "seller")) redirect("/");
  return { client, user, profile };
}
