import { getDatabase } from "@/db/client";
import { authenticatedActor } from "@/server/identity";
import { appealService } from "@/server/appeal-service";
import { AppealsCenter, AppealsUnavailable } from "@/components/appeals-center";
import { uuidSchema } from "@/domain/validation";
import { AppError } from "@/server/errors";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await authenticatedActor();
  if (!actor)
    return (
      <AppealsUnavailable
        message="로그인하면 본인에게 적용된 운영 조치와 이의신청 내역을 확인할 수 있어요."
        login
      />
    );
  const params = await searchParams;
  const page =
    typeof params.page === "string" &&
    /^[1-9]\d{0,4}$/.test(params.page) &&
    Number(params.page) <= 10000
      ? Number(params.page)
      : 1;
  const parsedId =
    typeof params.actionId === "string" ? uuidSchema.safeParse(params.actionId) : null;
  const actionId = parsedId?.success ? parsedId.data : null;
  try {
    const initial = await appealService(getDatabase()).list(actor, {
      page,
      ...(actionId ? { actionId } : {}),
    });
    return <AppealsCenter initial={initial} initialActionId={actionId} />;
  } catch (error) {
    if (
      error instanceof AppError &&
      ["FORBIDDEN", "UNAUTHENTICATED", "NOT_FOUND"].includes(error.code)
    )
      return (
        <AppealsUnavailable message="선택한 조치와 신청 내역을 확인할 수 없어요. 로그인과 계정 상태를 확인해주세요. 탈퇴한 계정은 이의신청을 이용할 수 없어요." />
      );
    throw error;
  }
}
