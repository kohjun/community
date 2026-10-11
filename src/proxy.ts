import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authConfiguration } from "./server/auth-config";
export async function proxy(request: NextRequest) {
  const config = authConfiguration();
  let response = NextResponse.next({ request });
  if (!config) return response;
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
