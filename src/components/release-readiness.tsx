import Link from "next/link";
import type { ReleaseReadiness } from "@/domain/release-readiness";

const groups = [
  {
    title: "서비스와 인증",
    ids: [
      "development-access",
      "site-origin",
      "authentication",
      "public-secrets",
      "visitor-signature",
    ],
  },
  { title: "데이터와 저장소", ids: ["database", "database-role", "migrations", "image-storage"] },
  { title: "신청과 결제", ids: ["payment-bridge", "external-approval", "library-payment"] },
  { title: "공지방과 기기 알림", ids: ["room-realtime", "web-push", "notification-worker"] },
  { title: "광고", ids: ["advertising"] },
  { title: "운영 확인", ids: ["operational-verification"] },
];
const labels: Record<string, string> = {
  "development-access": "운영 인증 모드",
  "site-origin": "서비스 주소",
  authentication: "회원 인증",
  "public-secrets": "공개 설정의 비밀키 검사",
  "visitor-signature": "방문자 서명",
  database: "데이터베이스",
  "database-role": "데이터베이스 권한 분리",
  migrations: "데이터베이스 변경 적용",
  "image-storage": "사진·영상 저장소",
  "payment-bridge": "행사 결제",
  "external-approval": "외부 참가 자동 승인",
  "library-payment": "자료 구매 자동 승인",
  "room-realtime": "공지방 갱신",
  "web-push": "기기 푸시",
  "notification-worker": "알림 처리 프로세스",
  advertising: "AdSense 광고",
  "operational-verification": "실제 운영 검증",
};
const statuses = { pass: "형식 확인됨", warn: "추가 확인", fail: "설정 보완" };
const nextSteps = [
  {
    ids: [
      "development-access",
      "site-origin",
      "authentication",
      "database",
      "database-role",
      "migrations",
      "public-secrets",
      "visitor-signature",
    ],
    title: "서비스와 회원 인증 준비",
    description:
      "서비스 도메인과 Supabase 프로젝트를 준비하고, 운영 권한을 분리한 뒤 카카오·구글 로그인 왕복을 검증하세요.",
  },
  {
    ids: ["image-storage"],
    title: "비공개 미디어 저장소 연결",
    description:
      "비공개 저장소의 업로드·열람 권한을 확인하고, 백업과 별도 환경 복원까지 점검하세요.",
  },
  {
    ids: ["payment-bridge", "external-approval", "library-payment"],
    title: "외부 플랫폼 거래 검증",
    description: "연동할 플랫폼을 정한 뒤 결제·승인·취소·환불 알림과 회원 연결을 검증하세요.",
  },
  {
    ids: ["room-realtime", "web-push", "notification-worker"],
    title: "공지방과 휴대폰 알림 검증",
    description:
      "별도 알림 프로세스의 처리를 확인하고 Android·iPhone에서 설치, 권한, 실제 알림 수신을 검증하세요.",
  },
  {
    ids: ["advertising"],
    title: "광고 계정과 광고 단위 준비",
    description: "게시자·광고 단위 ID를 설정하고 사이트 승인과 실제 광고 배치를 확인하세요.",
  },
];
function checkedTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "확인 시각 정보 없음"
    : date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}
export function ReleaseReadinessPanel({ data }: { data: ReleaseReadiness }) {
  const knownIds = new Set(groups.flatMap((group) => group.ids));
  const sections = [
    ...groups.map((group) => ({
      ...group,
      checks: data.checks.filter((check) => group.ids.includes(check.id)),
    })),
    { title: "기타 설정", checks: data.checks.filter((check) => !knownIds.has(check.id)) },
  ].filter((group) => group.checks.length > 0);
  const remaining = new Set(
    data.checks.filter((check) => check.status !== "pass").map((check) => check.id),
  );
  return (
    <section className="release-readiness" aria-labelledby="release-readiness-title">
      <nav className="release-readiness-nav" aria-label="운영 화면">
        <Link href="/admin/health">← 운영 점검</Link>
        <Link href="/admin/operations">운영 큐</Link>
        <form action="/admin/readiness" method="get">
          <button type="submit" className="participation-secondary">
            설정 다시 확인
          </button>
        </form>
      </nav>
      <header className="release-readiness-heading">
        <span className="release-readiness-eyebrow">관리자 · 읽기 전용</span>
        <h1 id="release-readiness-title">실서비스 연결 준비</h1>
        <p>
          현재 서버의 설정 형식을 확인해요. 실제 외부 연결·승인·기기 수신은 별도 검증이 필요해요.
        </p>
        <small>확인 시각 {checkedTime(data.checkedAt)} · 한국 시간</small>
      </header>
      <dl className="release-readiness-summary" aria-label="설정 형식 확인 결과">
        {(["pass", "warn", "fail"] as const).map((status) => (
          <div key={status} className={"release-readiness-summary-" + status}>
            <dt>{statuses[status]}</dt>
            <dd>
              {data.summary[status]}
              <span>개</span>
            </dd>
          </div>
        ))}
      </dl>
      <aside className="release-readiness-scope" aria-label="검사 범위">
        <strong>외부 검증은 수행하지 않았어요</strong>
        <p>
          설정 보완은 서비스 장애를 뜻하지 않아요. 로컬 개발 환경에서는 운영용 설정이 비어 있을 수
          있어요. 형식이 맞아도 실제 연결 성공이나 사이트 승인을 의미하지 않아요.
        </p>
      </aside>
      <div className="release-readiness-groups">
        {sections.map((section) => (
          <section
            className="release-readiness-group"
            key={section.title}
            aria-label={section.title}
          >
            <h2>{section.title}</h2>
            <ul>
              {section.checks.map((check, index) => (
                <li key={check.id + index}>
                  <div className="release-readiness-check-heading">
                    <h3>{labels[check.id] ?? "기타 설정"}</h3>
                    <span
                      className={
                        "release-readiness-status release-readiness-status-" + check.status
                      }
                    >
                      {statuses[check.status]}
                    </span>
                  </div>
                  <p>{check.message}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <section className="release-readiness-next" aria-labelledby="release-readiness-next-title">
        <h2 id="release-readiness-next-title">다음 확인 순서</h2>
        <ol>
          {nextSteps
            .filter((step) => step.ids.some((id) => remaining.has(id)))
            .map((step) => (
              <li key={step.title}>
                <strong>{step.title}</strong>
                <p>{step.description}</p>
              </li>
            ))}
          <li>
            <strong>실제 이용 흐름과 운영 복구 검증</strong>
            <p>
              설정 확인 후 로그인 → 신청·결제 → 공지방 → QR 입장 → 행사 기록 흐름과 기기 알림, 권한,
              부하, 백업 복원을 별도로 검증하세요.
            </p>
          </li>
        </ol>
        <p className="release-readiness-note">
          이 화면에서는 비밀키나 연결 주소를 표시하거나 수정하지 않아요.
        </p>
      </section>
    </section>
  );
}
