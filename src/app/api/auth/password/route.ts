import { z } from "zod";
import { safeProfileReturnTo } from "@/domain/profile";
import { authConfiguration } from "@/server/auth-config";
import { AppError } from "@/server/errors";
import { apiResponse, assertSameOrigin, readJson } from "@/server/http";
import { postAuthDestination } from "@/server/post-auth-destination";
import { supabaseAuth } from "@/server/supabase-auth";

const credentials = z.strictObject({
  action: z.enum(["signup", "login"]),
  email: z
    .string()
    .trim()
    .max(254)
    .pipe(z.email())
    .transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(1024),
  returnTo: z.string().max(2048).optional(),
});

export async function POST(request: Request) {
  return apiResponse(async () => {
    assertSameOrigin(request);
    const { action, email, password, returnTo } = credentials.parse(await readJson(request, 8192));
    const config = authConfiguration();
    const client = await supabaseAuth();
    if (!config || !client) throw new AppError("NOT_FOUND", "이메일 로그인을 사용할 수 없어요.");

    const next = safeProfileReturnTo(returnTo ?? "/");
    if (action === "signup" && (password.length < 8 || Buffer.byteLength(password, "utf8") > 72)) {
      throw new AppError("VALIDATION", "비밀번호는 8자 이상, 영문 기준 72자 이내로 입력해주세요.");
    }

    const callback = new URL("/auth/callback", config.origin);
    callback.searchParams.set("returnTo", next);
    const { data, error } =
      action === "signup"
        ? await client.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: callback.toString() },
          })
        : await client.auth.signInWithPassword({ email, password });

    if (error?.status === 429)
      throw new AppError("RATE_LIMITED", "요청이 많아요. 잠시 후 다시 시도해주세요.");

    if (action === "signup") {
      // Existing addresses receive the same response as a pending signup.
      if (error?.code === "user_already_exists" || error?.code === "email_exists")
        return { status: "confirmation_required" as const };
      if (error?.code === "weak_password")
        throw new AppError("VALIDATION", "다른 비밀번호를 입력해주세요.");
      if (error || !data.user)
        throw new AppError("INTERNAL", "가입 요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요.");
      if (!data.session) return { status: "confirmation_required" as const };
    }
    if (error?.code === "email_not_confirmed")
      throw new AppError("UNAUTHENTICATED", "가입 이메일의 확인 링크를 먼저 열어주세요.");
    if (error && error.status !== undefined && error.status >= 500)
      throw new AppError("INTERNAL", "로그인 연결이 지연되고 있어요. 잠시 후 다시 시도해주세요.");
    if (error || !data.session || !data.user)
      throw new AppError("UNAUTHENTICATED", "이메일 또는 비밀번호를 확인해주세요.");

    try {
      const redirect = await postAuthDestination(data.user.id, next);
      return { status: "authenticated" as const, redirect };
    } catch (error) {
      await client.auth.signOut({ scope: "local" });
      throw error;
    }
  });
}
