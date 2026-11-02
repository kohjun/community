import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { skipSessionRefresh } from "./domain/search-visibility";
import { authConfiguration } from "./server/auth-config";
import { canonicalLocalNavigation } from "./server/request-origin";
export async function proxy(request: NextRequest) {
  // Liveness probes must not refresh sessions or depend on upstream Auth availability.
  if (skipSessionRefresh(request.nextUrl.pathname, request.method)) return NextResponse.next();
  const config = authConfiguration();
  let response = NextResponse.next({ request });
  if (!config) return response;
  const canonical = canonicalLocalNavigation(request, config.origin);
  if (canonical) {
    // The Proxy adapter relativizes redirects between loopback aliases. A route handler
    // emits the absolute Location without that normalization (and without sharing cookies).
    const destination = request.nextUrl.clone();
    destination.pathname = "/auth/local-origin";
    destination.search = "";
    // An opaque URL-safe value also survives Proxy's rewrite-query decoding intact.
    destination.searchParams.set(
      "target",
      Buffer.from(canonical.pathname + canonical.search).toString("base64url"),
    );
    const rewritten = NextResponse.rewrite(destination);
    rewritten.headers.set("Cache-Control", "private, no-store");
    return rewritten;
  }
  const client = createServerClient(config.url, config.key, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: config.secure, path: "/" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => {
        for (const { name, value } of values) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of values) response.cookies.set(name, value, options);
      },
    },
  });
  await client.auth.getClaims();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|images/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js)$).*)",
  ],
};
