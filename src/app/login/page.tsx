import { headers } from "next/headers";
import { LoginPage } from "@/components/login-page";
import { localTestAuthAvailable } from "@/server/local-test-access";
import { loginReturnTo } from "@/domain/login-return";
import { authConfiguration } from "@/server/auth-config";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    returnTo?: string | string[];
    next?: string | string[];
    error?: string;
    withdrawn?: string;
  }>;
}) {
  const params = await searchParams;
  const returnTo = loginReturnTo(params);
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
