import { cookies, headers } from "next/headers";
import { supabaseAuth } from "@/server/supabase-auth";
import { apiResponse, assertSameOrigin, readJson } from "@/server/http";
import {
  LOCAL_TEST_SESSION_COOKIE,
  LOCAL_TEST_SESSION_MAX_AGE,
  loadLocalTestAccount,
  createLocalTestGuestSession,
} from "@/server/local-test-auth";
import { localTestAuthAvailable } from "@/server/local-test-access";
import { AppError } from "@/server/errors";
import { z } from "zod";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return apiResponse(async () => {
    assertSameOrigin(request);
    z.strictObject({}).parse(await readJson(request));
    const client = await supabaseAuth();
    if (client) {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw new AppError("INTERNAL", "로그아웃하지 못했어요. 다시 시도해주세요.");
    } else {
      const host = (await headers()).get("host"),
        account = localTestAuthAvailable(host) ? loadLocalTestAccount() : null;
      if (!account || !host) throw new AppError("NOT_FOUND", "로그인 환경이 준비되지 않았어요.");
      (await cookies()).set(LOCAL_TEST_SESSION_COOKIE, createLocalTestGuestSession(account, host), {
        httpOnly: true,
        sameSite: "lax",
        secure: new URL(request.url).protocol === "https:",
        path: "/",
        maxAge: LOCAL_TEST_SESSION_MAX_AGE,
      });
    }
    return { loggedOut: true };
  });
}
