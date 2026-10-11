import Link from "next/link";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { analyticsService } from "@/server/analytics-service";
import { ParticipationShell } from "@/components/participation-shell";
import { AppError } from "@/server/errors";
const date = (s: string) => new Date(s).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const actor = await currentActor(),
    service = analyticsService(getDatabase());
  try {
    await service.allowedAdmin(actor);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return (
      <ParticipationShell advertising={false}>
        <section className="safety-card">
          <h1>관리자 이용 현황</h1>
          <p>관리자 권한이 있는 계정으로 로그인해주세요.</p>
          <Link href="/login?returnTo=/admin/metrics">로그인</Link>
        </section>
      </ParticipationShell>
    );
  }
  const params = await searchParams;
  const data = await service.summary(actor, { days: params.days === "28" ? 28 : 7 }),
    c = data.counts;
  const rate = (n: number, d: number) => (d ? Math.round((n / d) * 100) + "%" : "관찰 중");
  const cards = [
    [
      "질문 24시간 내 답변",
      rate(c.answered_in_24h, c.question_denominator),
      c.answered_in_24h +
        " / " +
        c.question_denominator +
        "건 · 24시간 관찰 완료 · 다른 일반 회원의 현재 공개 댓글 기준",
    ],
    [
      "신규 가입",
      c.registrations + "명",
      "같은 기간 테스트·운영·제한 계정 " + c.excluded + "명 제외",
    ],
    [
      "가입 7일 내 활동 확인",
      rate(c.activated, c.action_denominator),
      c.activated + " / " + c.action_denominator + "명 · 관찰 기간이 지난 가입자",
    ],
    [
      "가입 다음 날~7일 내 재방문",
      rate(c.returned, c.return_denominator),
      c.returned + " / " + c.return_denominator + "명 · 수집 시작 후 가입자",
    ],
    [
      "최근 28일 반복 방문",
      c.repeat_members + "명" + (data.repeatCoverageComplete ? "" : " · 수집 중"),
      "서로 다른 한국 날짜에 2일 이상 방문",
    ],
    ["참가 신청 접수", c.applications + "건", "사이트 신청과 외부 확인 요청 · 링크 클릭 제외"],
    ["참가 확정 처리", c.confirmations + "건", "기간 내 확정 시각 기준 · 이후 환불과 별도"],
    ["완료 확인 행사", c.completed_events + "건", "담당자가 완료 확인 · 샘플·취소 행사 제외"],
    [
      "완료 행사 참가 연인원",
      c.attended + "명",
      "QR " + c.qr_attended + "명 · 담당자 확인 " + c.manager_attended + "명",
    ],
    [
      "완료 7일 내 회고 공개",
      rate(c.published, c.record_denominator),
      c.published + " / " + c.record_denominator + "건 · 완료 후 7일 지난 행사",
    ],
    ["참가 인증 후기", c.verified_reviews + "건", "기간 내 작성되어 현재 남아 있는 인증 후기"],
    [
      "다른 호스트의 자료 재사용",
      c.reused_events + "건",
      "타인 자료를 사용한 완료 행사 · 행사별 한 번",
    ],
  ];
  return (
    <ParticipationShell advertising={false}>
      <section className="metrics-page">
        <Link href="/admin" className="record-backlink">
          ← 운영 관리
        </Link>
        <h1>커뮤니티 이용 현황</h1>
        <p>실제 신청과 행사 기록을 기준으로, 다음 개선을 확인해요.</p>
        <nav className="metrics-period" aria-label="집계 기간">
          {[7, 28].map((days) => (
            <Link
              key={days}
              href={"/admin/metrics?days=" + days}
              aria-current={data.days === days ? "page" : undefined}
            >
              최근 {days}일
            </Link>
          ))}
        </nav>
        <p className="metrics-caption">
          {date(data.start)} ~ {date(data.end)} · 한국 시간
        </p>
        <div className="metrics-grid">
          {cards.map(([title, value, note]) => (
            <article key={title}>
              <h2>{title}</h2>
              <strong>{value}</strong>
              <p>{note}</p>
            </article>
          ))}
        </div>
        <p className="metrics-caption">
          활동·재방문 비율의 가입 집단: {date(data.signupCohort.start)} ~{" "}
          {date(data.signupCohort.end)} 미만. 회고 비율의 완료 집단: {date(data.recordCohort.start)}{" "}
          ~ {date(data.recordCohort.end)} 미만.
        </p>
        <section className="metrics-definition">
          <h2>숫자를 읽는 기준</h2>
          <p>
            재방문 수집 시작: {date(data.collectionStartedAt)}. 수집 이전의 방문은 복원하지 않아요.
            분모가 없으면 0% 대신 ‘관찰 중’으로 표시해요.
          </p>
          <p>
            가입 7일 내 활동은 현재 보관된 북마크·댓글·사이트 신청에서 확인해요. 삭제한 댓글·해제한
            북마크는 복원하지 않으므로 최초 행동 전환율의 하한값이에요. 비율은 관찰 기간이 끝난 이전
            가입 집단을 사용해요. 오늘 가입한 회원을 실패로 세지 않으며, 위에 표시한 가입 기간은
            신규 가입 수의 집계 기간과 달라요.
          </p>
          <p>
            참가 인원은 이 기간에 완료된 행사의 실제 참석 전적이에요. 한 사람이 여러 행사에 참석하면
            각각 포함하며, 미참석은 제외하고 실제 참석 후 환불은 유지해요. 위 숫자들은 서로 다른
            발생 시각으로 집계하므로 하나의 전환율로 나누지 않아요.
          </p>
          <p>
            회고는 현재 공개된 기록 기준이에요. 재공개·철회로 바뀔 수 있어요. 자료 재사용은 실제
            연결된 템플릿 출처 기준이며 단순 관련 링크는 포함하지 않아요.
          </p>
          <p>
            방문 날짜만 90일 범위로 집계하고, 다음 수집 때 만료 자료를 삭제해요. 탈퇴 시 활동 날짜를
            삭제해요. 본문·연락처·좌표·기기 식별자를 추가 수집하지 않아요.
          </p>
        </section>
      </section>
    </ParticipationShell>
  );
}
