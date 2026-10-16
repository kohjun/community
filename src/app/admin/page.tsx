import Link from "next/link";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { safetyService } from "@/server/safety-service";
import { SafetyCenter } from "@/components/safety-center";
import { ParticipationShell } from "@/components/participation-shell";
import { uuidSchema } from "@/domain/validation";
import { AppError } from "@/server/errors";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await currentActor(),
    service = safetyService(getDatabase());
  if (!(await service.role(actor)))
    return (
      <ParticipationShell advertising={false}>
        <section className="safety-page safety-card">
          <h1>운영자 전용 공간</h1>
          <p>운영 권한이 있는 계정으로 로그인해주세요.</p>
          <Link href="/login?returnTo=/admin">로그인</Link>
        </section>
      </ParticipationShell>
    );
  const params = await searchParams;
  const tab = params.tab === "support" || params.tab === "audit" ? params.tab : "reports";
  const parsedId = typeof params.id === "string" ? uuidSchema.safeParse(params.id) : null;
  const focusId = tab !== "audit" && parsedId?.success ? parsedId.data : null;
  const page =
    typeof params.page === "string" &&
    /^[1-9]\d{0,4}$/.test(params.page) &&
    Number(params.page) <= 10000
      ? Number(params.page)
      : 1;
  let initialError = "";
  const initialWork = async () => {
    if (focusId) {
      try {
        const item =
          tab === "support"
            ? await service.ticketDetail(actor, focusId)
            : await service.reportDetail(actor, focusId);
        return { items: [item], hasMore: false, page: 1 };
      } catch (error) {
        if (
          !(error instanceof AppError) ||
          !["NOT_FOUND", "FORBIDDEN", "UNAUTHENTICATED"].includes(error.code)
        )
          throw error;
        initialError =
          "선택한 항목을 확인할 수 없어요. 접근 권한이나 현재 처리 상태를 확인해주세요.";
        return { items: [], hasMore: false, page: 1 };
      }
    }
    if (tab === "support") return service.tickets(actor, true, page);
    if (tab === "audit") return service.audit(actor, page);
    return service.reports(actor, true, page);
  };
  const [initial, account] = await Promise.all([initialWork(), service.account(actor)]);
  return (
    <SafetyCenter
      kind="admin"
      initial={initial}
      account={account}
      initialTab={tab}
      initialFocusId={focusId}
      initialError={initialError}
    />
  );
}
