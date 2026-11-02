import { launchPreparation } from "@/server/launch-preparation";
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
  let content;
  try {
    data = await releaseReadinessService(getDatabase()).snapshot(await currentActor());
    content = await launchPreparation(getDatabase(), await currentActor());
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
      {content && (
        <section className="safety-card">
          <h2>실제 콘텐츠 준비</h2>
          <p>샘플을 제외한 공개 상태를 확인해요. 콘텐츠 수가 실제 고객 실적을 뜻하지는 않아요.</p>
          <dl className="launch-content">
            <div>
              <dt>관리자</dt>
              <dd>{content.administrators}명</dd>
            </div>
            <div>
              <dt>예정 모집</dt>
              <dd>{content.upcoming}개</dd>
            </div>
            <div>
              <dt>공개 자료</dt>
              <dd>{content.materials}개</dd>
            </div>
            <div>
              <dt>일반 글 / 샘플</dt>
              <dd>
                {content.stories} / {content.samples}개
              </dd>
            </div>
          </dl>
          <p>
            첫 운영 목표: 한 지역의 주최자 3~5명, 실제 모임 3회와 공개 진행 자료 3개. 예시 모임을
            실제 모집처럼 만들지 않고, 주최자가 동의한 일정과 자료를 등록해주세요.
          </p>
          <div className="safety-links">
            <Link href="/hosting-guide">4주 운영 가이드</Link>
            <Link href="/archive">자료 발행</Link>
            <Link href="/lightning">모임 준비</Link>
          </div>
        </section>
      )}
    </ParticipationShell>
  );
}
