import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { profiles } from "@/db/schema";
import { memberSafety } from "@/db/safety-schema";
import { supabaseAuth } from "@/server/supabase-auth";
import { authConfiguration } from "@/server/auth-config";
import { membershipActive } from "@/domain/safety";
import { isProfileReadyForApplication, safeProfileReturnTo } from "@/domain/profile";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const config = authConfiguration(),
    origin = config?.origin ?? process.env.APP_ORIGIN ?? "http://127.0.0.1:3000";
  try {
    const code = new URL(request.url).searchParams.get("code"),
      client = await supabaseAuth();
    if (!config || !client || !code) throw new Error("Missing code");
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) throw error;
    const { data, error: userError } = await client.auth.getUser();
    if (userError || !data.user) throw new Error("Unverified identity");
    const actor = data.user.id,
      db = getDatabase();
    await db.insert(profiles).values({ id: actor, nickname: "슬리퍼 회원" }).onConflictDoNothing();
    const [state] = await db.select().from(memberSafety).where(eq(memberSafety.userId, actor));
    const [profile] = await db.select().from(profiles).where(eq(profiles.id, actor));
    if (!membershipActive(state))
      return NextResponse.redirect(new URL("/settings/account", origin));
    if (!profile) throw new Error("Missing profile");
    const next = safeProfileReturnTo(new URL(request.url).searchParams.get("returnTo") ?? "/");
    const destination = isProfileReadyForApplication(profile)
      ? next
      : "/signup?returnTo=" + encodeURIComponent(next);
    const response = NextResponse.redirect(new URL(destination, origin));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    // Never return provider errors, tokens or authorization codes to the browser.
    return NextResponse.redirect(new URL("/login?error=callback", origin));
  }
}
