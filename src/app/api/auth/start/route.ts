import { NextResponse } from "next/server";
import { supabaseAuth } from "@/server/supabase-auth";
import { authConfiguration } from "@/server/auth-config";
import { assertSameOrigin, readBody } from "@/server/http";
import { safeProfileReturnTo } from "@/domain/profile";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const config = authConfiguration();
  if (!config)
    return NextResponse.redirect(
      new URL("/login?error=configuration", process.env.APP_ORIGIN ?? "http://127.0.0.1:3000"),
      303,
    );
  try {
    assertSameOrigin(request);
    const fields = new URLSearchParams((await readBody(request, 4096)).toString("utf8"));
    const provider = fields.get("provider");
    if (provider !== "google" && provider !== "kakao") throw new Error("Invalid provider");
    const next = safeProfileReturnTo(fields.get("returnTo") ?? "/");
    const callback = new URL("/auth/callback", config.origin);
    callback.searchParams.set("returnTo", next);
    const client = await supabaseAuth();
    const { data, error } = await client!.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callback.toString(), skipBrowserRedirect: true },
    });
    if (error || !data.url) throw new Error("OAuth unavailable");
    const response = NextResponse.redirect(data.url, 303);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    return NextResponse.redirect(new URL("/login?error=provider", config.origin), 303);
  }
}
