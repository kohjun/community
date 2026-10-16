import Link from "next/link";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { mediaRetentionService } from "@/server/media-retention-service";
import { ParticipationShell } from "@/components/participation-shell";
import { AppError } from "@/server/errors";
export const dynamic = "force-dynamic";
export default async function Page() {
  let data;
  try {
    data = await mediaRetentionService(getDatabase()).adminSummary(await currentActor());
  } catch (error) {
    if (!(error instanceof AppError) || !["UNAUTHENTICATED", "FORBIDDEN"].includes(error.code))
      throw error;
    return (
      <ParticipationShell advertising={false}>
        <section className="safety-card">
          <h1>미디어 보관 관리</h1>
          <p>관리자 권한이 있는 계정으로 로그인해주세요.</p>
          <Link href="/login?returnTo=/admin/media-retention">로그인</Link>
        </section>
      </ParticipationShell>
    );
  }
  const cards = [
    ["정리 가능한 미첨부 사진", data.eligibleImages],
    ["정리 가능한 미첨부 영상", data.eligibleVideos],
    ["정리 대기", data.queued],
    ["처리 중", data.processing],
    ["삭제 실패·확인 필요", data.failed],
    ["정리 완료", data.removed],
  ];
  return (
    <ParticipationShell advertising={false}>
      <main className="metrics-page">
        <nav className="operations-health-links">
          <Link href="/admin/health">← 운영 점검</Link>
          <form action="/admin/media-retention" method="get">
            <button className="participation-secondary" type="submit">
              다시 확인
            </button>
          </form>
        </nav>
        <h1>미디어 보관 관리</h1>
        <p>첨부하지 않은 사진·영상은 마지막 첨부 해제 후 {data.retentionDays}일간 보관해요.</p>
        <p className="metrics-caption">
          확인 시각 {new Date(data.checkedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
        </p>
        <div className="metrics-grid">
          {cards.map(([label, count]) => (
            <article key={label}>
              <h2>{label}</h2>
              <strong>
                {count}
                <small>개</small>
              </strong>
            </article>
          ))}
        </div>
        <section className="metrics-definition">
          <h2>첨부한 파일은 보존해요</h2>
          <p>
            게시글에 첨부된 파일, 프로필 사진, 행사 기록에 연결된 파일은 이 정리 대상에서 제외해요.
            예전 미첨부 파일도 정책 적용일부터 30일간 유예합니다. 파일 이름이나 소유자의 정보를 이
            화면에 표시하지 않아요.
          </p>
          <p>
            이 화면은 미리보기만 제공합니다. 정리는 관리 도구에서 별도로 실행하며, 삭제 대상을 잠근
            뒤 첨부 여부를 다시 확인합니다. 삭제가 실패하면 원래 글과 연결하지 않고 정리 작업만
            재시도해요.
          </p>
        </section>
      </main>
    </ParticipationShell>
  );
}
