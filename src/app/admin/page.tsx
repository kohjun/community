import Link from "next/link";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { safetyService } from "@/server/safety-service";
import { SafetyCenter } from "@/components/safety-center";
import { ParticipationShell } from "@/components/participation-shell";
export const dynamic = "force-dynamic";
export default async function Page() {
  const actor = await currentActor(),
    service = safetyService(getDatabase());
  if (!(await service.role(actor)))
    return (
      <ParticipationShell>
        <section className="safety-page safety-card">
          <h1>운영자 전용 공간</h1>
          <p>운영 권한이 있는 계정으로 로그인해주세요.</p>
          <Link href="/login?returnTo=/admin">로그인</Link>
        </section>
      </ParticipationShell>
    );
  return (
    <SafetyCenter
      kind="admin"
      initial={await service.reports(actor, true)}
      account={await service.account(actor)}
    />
  );
}
