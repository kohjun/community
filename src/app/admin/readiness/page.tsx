import Link from "next/link";
import { ParticipationShell } from "@/components/participation-shell";
import { ReleaseReadinessPanel } from "@/components/release-readiness";
import { getDatabase } from "@/db/client";
import { AppError } from "@/server/errors";
import { currentActor } from "@/server/identity";
import { releaseReadinessService } from "@/server/release-readiness-service";

export const dynamic = "force-dynamic";
export default async function Page() {
  let data;
  try {
    data = await releaseReadinessService(getDatabase()).snapshot(await currentActor());
  } catch (error) {
    if (!(error instanceof AppError) || !["UNAUTHENTICATED", "FORBIDDEN"].includes(error.code))
      throw error;
    return (
      <ParticipationShell advertising={false}>
        <section className="safety-card">
          <h1>실서비스 연결 준비</h1>
          <p>관리자 권한이 있는 계정으로 로그인해주세요.</p>
          <Link href="/login?returnTo=/admin/readiness">로그인</Link>
        </section>
      </ParticipationShell>
    );
  }
  return (
    <ParticipationShell advertising={false}>
      <ReleaseReadinessPanel data={data} />
    </ParticipationShell>
  );
}
