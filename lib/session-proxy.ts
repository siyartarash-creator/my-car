import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function refreshSession(request: NextRequest) {
  // Server Actions (POST requests carrying Next's own `next-action` header)
  // must pass through untouched. Netlify's Edge Functions runtime can only
  // add response headers and cannot fully replicate Vercel's edge semantics
  // for a middleware that reconstructs `NextResponse.next({ request })`
  // with rewritten cookies on every `setAll` call (as the Supabase SSR
  // cookie-refresh pattern below does) -- on Netlify this corrupts the
  // Server Action's `text/x-component` response, surfacing to the browser
  // as "An unexpected response was received from the server" with the
  // action never actually completing. Server Actions don't need this
  // proactive refresh anyway: every action handler (see requireRole in
  // lib/auth-server.ts) creates its own Supabase server client and calls
  // auth.getUser() itself, reading the real cookies via next/headers.
  if (request.headers.has("next-action")) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const cacheHeaders: Record<string, string> = {};

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          const previousCookies = response.cookies.getAll();
          Object.assign(cacheHeaders, headers);
          response = NextResponse.next({ request });
          previousCookies.forEach(cookie => response.cookies.set(cookie));
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
          Object.entries(cacheHeaders).forEach(([name,value]) => response.headers.set(name,value));
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isProtected =
    pathname.startsWith("/admin") || pathname.startsWith("/seller");

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    Object.entries(cacheHeaders).forEach(([name,value]) => redirect.headers.set(name,value));
    redirect.headers.set("Cache-Control", "private, no-store");
    return redirect;
  }

  if (user) response.headers.set("Cache-Control", "private, no-store");
  return response;
}
