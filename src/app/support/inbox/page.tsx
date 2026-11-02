import Link from "next/link";
import { getDatabase } from "@/db/client";
import { authenticatedActor } from "@/server/identity";
import { safetyService } from "@/server/safety-service";
import { SafetyCenter } from "@/components/safety-center";
import { ParticipationShell } from "@/components/participation-shell";
import { OperatorContact } from "@/components/operator-contact";
import { AppError } from "@/server/errors";
export const dynamic = "force-dynamic";
export default async function Page() {
  const actor = await authenticatedActor();
  if (actor) {
    try {
      const tickets = await safetyService(getDatabase()).tickets(actor);
      return (
        <>
          <SafetyCenter kind="support" initial={tickets} />
          <div className="support-alternative">
            <OperatorContact />
          </div>
        </>
      );
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "FORBIDDEN") throw error;
    }
  }
  return (
    <ParticipationShell advertising={false}>
      <div className="safety-page">
        <header className="safety-heading">
          <div>
            <p className="safety-eyebrow">도움이 필요할 때</p>
            <h1>문의와 개인정보 요청</h1>
            <p>계정에 접속할 수 없어도 도움을 요청할 수 있어요.</p>
          </div>
        </header>
        <OperatorContact />
        <section className="safety-card">
          <h2>내 문의와 답변 확인</h2>
          <p>로그인한 회원은 사이트에서 문의를 작성하고 답변을 확인할 수 있어요.</p>
          <Link href="/login?returnTo=%2Fsupport%2Finbox" className="support-inbox-link">
            로그인하고 문의하기
          </Link>
        </section>
      </div>
    </ParticipationShell>
  );
}
