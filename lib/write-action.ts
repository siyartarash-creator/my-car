import type { createClient } from "@/lib/supabase-server";

// One write action = which database function to call, with which arguments.
// Each module (shop, finance, rescue) owns its own actions; the route only dispatches.
export type WriteClient = Awaited<ReturnType<typeof createClient>>;
export type WriteCall = { name: string; args: Record<string, unknown> };
export type WriteAction = {
  call: (v: Record<string, unknown>) => WriteCall;
  // Optional pre-step (for example, looking up an account). Returns an error message to refuse, or null to continue.
  prepare?: (client: WriteClient, v: Record<string, unknown>) => Promise<string | null>;
};
