import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import { profiles } from "@/db/schema";
import { isProfileReadyForApplication } from "@/domain/profile";
import { AppError } from "@/server/errors";
import { apiResponse, assertSameOrigin, readJson } from "@/server/http";
import { localTestAuthAvailable, TestLoginThrottle } from "@/server/local-test-access";
import {
  LOCAL_TEST_SESSION_COOKIE,
  LOCAL_TEST_SESSION_MAX_AGE,
  loadLocalTestAccount,
  createLocalTestSession,
  createLocalTestGuestSession,
  readLocalTestSession,
  verifyTestAccountLogin,
} from "@/server/local-test-auth";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const loginSchema = z.strictObject({
  username: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(256),
});
const state = globalThis as unknown as { sliperTestLoginThrottle?: TestLoginThrottle };
const throttle = (state.sliperTestLoginThrottle ??= new TestLoginThrottle());
async function handle(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  return apiResponse(async () => {
    const { path = [] } = await context.params;
    const host = (await headers()).get("host");
    const available = localTestAuthAvailable(host);
    const method = request.method === "HEAD" ? "GET" : request.method;
    if (method !== "GET") assertSameOrigin(request);
    const account = available ? loadLocalTestAccount() : null;
    if (path.length === 1 && path[0] === "session" && method === "GET") {
      if (!account || !host) return { available: false, authenticated: false, nickname: null };
      const token = (await cookies()).get(LOCAL_TEST_SESSION_COOKIE)?.value;
      const session = readLocalTestSession(token, account, host);
      const [profile] = session?.userId
        ? await getDatabase()
            .select({ nickname: profiles.nickname })
            .from(profiles)
            .where(eq(profiles.id, session.userId))
        : [];
      return { available: true, authenticated: !!profile, nickname: profile?.nickname ?? null };
    }
    if (!account || !host)
      throw new AppError("NOT_FOUND", "테스트 로그인은 준비된 로컬 환경에서만 사용할 수 있어요.");
    async function setSession(token: string) {
      (await cookies()).set(LOCAL_TEST_SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: new URL(request.url).protocol === "https:",
        path: "/",
        maxAge: LOCAL_TEST_SESSION_MAX_AGE,
      });
    }
    if (path.length === 1 && path[0] === "login" && method === "POST") {
      const input = loginSchema.parse(await readJson(request));
      throttle.begin();
      let successful = false;
      try {
        if (!(await verifyTestAccountLogin(input, account)))
          throw new AppError("UNAUTHENTICATED", "아이디와 비밀번호를 확인해주세요.");
        const [profile] = await getDatabase()
          .select({
            nickname: profiles.nickname,
            phoneNumber: profiles.phoneNumber,
            profileCompletedAt: profiles.profileCompletedAt,
            onboardingConsentAt: profiles.onboardingConsentAt,
          })
          .from(profiles)
          .where(eq(profiles.id, account.userId));
        if (!profile) throw new AppError("NOT_FOUND", "테스트 계정이 준비되지 않았어요.");
        await setSession(createLocalTestSession(account, host));
        successful = true;
        return {
          nickname: profile.nickname,
          redirect: isProfileReadyForApplication(profile) ? "/" : "/signup",
        };
      } finally {
        throttle.finish(successful);
      }
    }
    if (path.length === 1 && path[0] === "logout" && method === "POST") {
      z.strictObject({}).parse(await readJson(request));
      await setSession(createLocalTestGuestSession(account, host));
      return { loggedOut: true };
    }
    throw new AppError("NOT_FOUND", "인증 기능을 찾을 수 없어요.");
  });
}
export { handle as GET, handle as HEAD, handle as POST };
