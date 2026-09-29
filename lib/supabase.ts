import { createBrowserClient } from "@supabase/ssr";

// Browser and server share the same cookie-backed Supabase session.
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
