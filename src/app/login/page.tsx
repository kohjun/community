import { headers } from "next/headers";
import { LoginPage } from "@/components/login-page";
import { localTestAuthAvailable } from "@/server/local-test-access";
import { safeProfileReturnTo } from "@/domain/profile";
import { authConfiguration } from "@/server/auth-config";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[]; error?: string; withdrawn?: string }>;
}) {
  const params = await searchParams;
  let target = params.returnTo;
  // A guest can arrive from the basic-information screen; keep its event destination.
  if (typeof target === "string") {
    try {
      const parsed = new URL(target, "https://sliper.local");
      if (parsed.origin === "https://sliper.local" && parsed.pathname === "/signup")
        target = parsed.searchParams.get("returnTo") ?? "/mypage";
    } catch {
      target = undefined;
    }
  }
  const returnTo = target === undefined ? "/" : safeProfileReturnTo(target);
  return (
    <LoginPage
      localTestLoginAvailable={localTestAuthAvailable((await headers()).get("host"))}
      returnTo={returnTo}
      socialLoginAvailable={!!authConfiguration()}
      initialNotice={
        params.withdrawn
          ? "탈퇴 처리를 완료했어요."
          : params.error
            ? "로그인 연결을 완료하지 못했어요. 다시 시도하거나 문의해주세요."
            : ""
      }
    />
  );
}
