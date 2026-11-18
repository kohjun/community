import { NextResponse } from "next/server";
import { supabaseAuth } from "@/server/supabase-auth";
import { authConfiguration } from "@/server/auth-config";
import { postAuthDestination } from "@/server/post-auth-destination";
import { safeProfileReturnTo } from "@/domain/profile";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const config = authConfiguration(),
    origin = config?.origin ?? process.env.APP_ORIGIN ?? "http://127.0.0.1:3000";
  const params = new URL(request.url).searchParams;
  const next = safeProfileReturnTo(params.get("returnTo") ?? "/");
  try {
    const code = params.get("code"),
      client = await supabaseAuth();
    if (!config || !client || !code) throw new Error("Missing code");
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) throw error;
    const { data, error: userError } = await client.auth.getUser();
    if (userError || !data.user) throw new Error("Unverified identity");
    const destination = await postAuthDestination(data.user.id, next);
    const response = NextResponse.redirect(new URL(destination, origin));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    // Never return provider errors, tokens or authorization codes to the browser.
    const login = new URL("/login", origin);
    login.searchParams.set("error", "callback");
    login.searchParams.set("returnTo", next);
    const response = NextResponse.redirect(login);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
