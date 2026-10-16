import Link from "next/link";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { operationsHealthService } from "@/server/operations-health-service";
import { AppError } from "@/server/errors";
import { ParticipationShell } from "@/components/participation-shell";
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "기록 없음";
export const dynamic = "force-dynamic";
export default async function Page() {
  let data;
  try {
    data = await operationsHealthService(getDatabase()).snapshot(await currentActor());
  } catch (error) {
    if (!(error instanceof AppError) || !["UNAUTHENTICATED", "FORBIDDEN"].includes(error.code))
      throw error;
    return (
      <ParticipationShell advertising={false}>
        <section className="safety-page safety-card">
          <h1>운영 점검</h1>
          <p>관리자 권한이 있는 계정으로 로그인해주세요.</p>
          <Link href="/login?returnTo=/admin/health">로그인</Link>
        </section>
      </ParticipationShell>
    );
  }
  const config = data.configuration;
  const connection = (state: "configured" | "disabled" | "invalid") =>
    state === "configured"
      ? "설정됨 · 연결 미확인"
      : state === "disabled"
        ? "미설정"
        : "설정 확인 필요";
  const settings = [
    [
      "사진·영상 저장",
      config.mediaStorage === "local"
        ? "로컬 파일"
        : config.mediaStorage === "supabase"
          ? "클라우드 설정됨 · 권한 미확인"
          : "설정 확인 필요",
    ],
    ["공지방 빠른 갱신", connection(config.roomUpdates)],
    ["기기 알림", connection(config.push)],
    [
      "알림 처리",
      config.pushWorker === "embedded"
        ? "사이트 내 실행 설정"
        : config.pushWorker === "external"
          ? "별도 실행 설정"
          : "설정 확인 필요",
    ],
  ];
  const media = [
    ["24시간 이상 미첨부 사진 · 관찰", data.media.abandonedImages],
    ["24시간 이상 미첨부 영상 · 관찰", data.media.abandonedVideos],
    ["정리 조건에 도달한 영상 원본", data.media.videoSourcesToClean],
    ["정리 시각이 지난 미공개 변환 결과", data.media.videoOutputsToClean],
  ];
  return (
    <ParticipationShell advertising={false}>
      <main className="metrics-page operations-health-page">
        <nav className="operations-health-links" aria-label="운영 화면">
          <Link href="/admin/operations">← 운영 큐</Link>
          <Link href="/admin/metrics">이용 현황</Link>
          <Link href="/admin/readiness">실서비스 연결 점검</Link>
          <Link href="/admin/media-retention">미디어 보관 관리</Link>
          <form action="/admin/health" method="get">
            <button className="participation-secondary" type="submit">
              다시 점검
            </button>
          </form>
        </nav>
        <h1>운영 점검</h1>
        <p>알림과 영상의 처리 지연을 살피고 연결 설정을 확인해요.</p>
        <p className="metrics-caption">확인 시각 {date(data.checkedAt)} · 한국 시간</p>
        <div className="metrics-grid operations-health-queues">
          {data.queues.map((queue) => (
            <article key={queue.key}>
              <h2>{queue.label}</h2>
              <strong>
                {queue.waiting}
                <small>건 대기</small>
              </strong>
              <dl className="operations-health-counts">
                {[
                  ["처리 중", queue.processing],
                  ["재시도 대상", queue.retrying],
                  ["보관된 실패", queue.failed],
                  ["임대 만료", queue.staleLeases],
                ].map(([label, count]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{count}건</dd>
                  </div>
                ))}
              </dl>
              <p>
                가장 오래 기다린 시각
                <br />
                {date(queue.oldestWaitingAt)}
              </p>
              <p>
                최근 성공 처리
                <br />
                {date(queue.latestCompletedAt)}
              </p>
            </article>
          ))}
        </div>
        <section className="metrics-definition">
          <h2>이 숫자로 확인할 수 있는 범위</h2>
          <p>
            현재 처리 가능한 대기 건과 DB에 남은 처리 기록이에요. 실패는 보관된 누적 건수이며 재시도
            대상은 대기 건과 겹칠 수 있어요. 임대가 만료된 작업은 실행 프로세스의 상태를
            확인해주세요.
          </p>
          <p>
            처리할 작업이 없다는 이유만으로 작업 프로세스가 실행 중이라고 판단할 수 없어요. 연결
            설정 확인과 실제 푸시 수신·영상 변환·공지방 갱신 검증은 별개예요.
          </p>
        </section>
        <section className="record-panel">
          <h2>연결 설정</h2>
          <dl className="operations-health-settings">
            {settings.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="record-note">
            연결 주소와 비밀키를 표시하지 않으며 이 화면에서 외부 연결을 시험하지 않아요.
          </p>
        </section>
        <section className="record-panel">
          <h2>미디어 보관 점검</h2>
          <Link className="record-backlink" href="/admin/media-retention">
            30일 보관 정책과 정리 상태 보기 →
          </Link>
          <dl className="operations-health-settings">
            {media.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}개</dd>
              </div>
            ))}
          </dl>
          <p className="record-note">
            24시간 수치는 최근 첨부 상태를 살피는 관찰 지표이며 실제 삭제 대상과 다릅니다. 이
            화면에서 파일을 삭제하지 않아요. 영상 원본과 미공개 결과는 기존 영상 작업 프로세스가
            조건과 소유 관계를 다시 확인한 뒤 정리해요. 미첨부 사진·영상은 마지막 첨부 해제 후 30일
            보관 정책을 적용하며 관리자 보관 화면에서 별도 점검해요.
          </p>
        </section>
      </main>
    </ParticipationShell>
  );
}
