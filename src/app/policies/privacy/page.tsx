import Link from "next/link";
import { ParticipationShell } from "@/components/participation-shell";
import { OperatorContact } from "@/components/operator-contact";
import { readSiteOperations } from "@/domain/site-operations";
import { publicPageMetadata } from "@/domain/search-visibility";
export const dynamic = "force-dynamic";
export function generateMetadata() {
  return publicPageMetadata("/policies/privacy");
}
const rows = [
  [
    "웹 게임",
    "게임방 닉네임, 스스로 선택한 MBTI, 라운드별 추리와 결과, 브라우저 구분용 해시",
    "게임 참가·진행과 결과 공개. MBTI는 자기소개 게임 종료 후 해당 방 참가자와 호스트에게 공개",
    "게임방의 이용 시간은 24시간입니다. 닫히거나 이용 시간이 지난 방의 열람을 제한하며, 서버 기록은 운영 정리 시까지 남을 수 있습니다. 삭제 요청은 공개 문의 이메일로 접수할 수 있고 사이트 프로필의 MBTI로 연결하지 않습니다.",
  ],
  [
    "계정·프로필",
    "소셜 계정 식별자, 닉네임·연락처, 선택한 소개·관심사·사진",
    "계정 식별·참가 연락·선택한 공개 프로필 제공",
    "프로필 정보는 서비스 이용 중 보관하며 탈퇴 시 연락처·소개·관심사·사진 연결을 삭제합니다. 계정 식별과 과거 기록 연결은 남을 수 있습니다.",
  ],
  [
    "행사 신청·운영",
    "신청 당시 닉네임·연락처, 요청사항·질문 답변, 승인·출석·취소 이력",
    "행사 담당자의 신청 확인·진행·문의 대응",
    "탈퇴만으로 과거 신청 원장이 자동 삭제되지는 않습니다. 정보 삭제·보관 범위 확인은 공개 이메일로 요청할 수 있습니다.",
  ],
  [
    "작성물·활동",
    "글·댓글·후기·회고·제작 경력, 공개 범위·동의 이력",
    "커뮤니티 제공과 참가·제작 활동 기록",
    "작성물은 작성자가 삭제하거나 운영 조치로 정리할 때까지 남을 수 있습니다. 탈퇴 후 작성자 표시를 ‘탈퇴한 회원’으로 변경합니다.",
  ],
  [
    "기기 알림",
    "푸시 구독 주소·발송용 키, 수신 항목·발송 상태",
    "선택한 댓글·행사 공지의 기기 알림 전달",
    "기기 연결 해제·탈퇴 시 구독을 삭제합니다. 이미 발송된 알림 이력은 별도 운영 기록으로 남을 수 있습니다.",
  ],
  [
    "방문 날짜",
    "로그인 회원의 한국 시간 기준 방문일",
    "재방문·서비스 이용 현황의 합계 집계",
    "90일 범위로 집계하고 이후 수집 시 만료 기록을 정리합니다. 탈퇴 시 삭제합니다.",
  ],
  [
    "사진·영상",
    "업로드한 파일과 작성자·소속 콘텐츠 정보",
    "글·프로필·행사 기록 표시와 파일 변환",
    "콘텐츠에 연결된 파일은 해당 공개·보관 정책을 따릅니다. 미첨부 파일의 보관 기준은 30일이며 정리 실행·보관 현황을 운영자가 점검합니다.",
  ],
  [
    "신고·문의·거래 원장",
    "신고 사유·대상 사본, 문의·답변, 외부 거래 확인·환불 처리 정보",
    "안전 조치·이의 검토·문의와 분쟁 대응",
    "탈퇴만으로 관련 원장이 모두 삭제되지는 않습니다. 목적별 보유·파기 기간과 거래 운영 조건은 최종 검토 중이며, 요청 시 보관 범위와 처리 결과를 안내합니다.",
  ],
];
export default function Page() {
  const config = readSiteOperations(process.env);
  return (
    <ParticipationShell advertising={false}>
      <article className="safety-page policy-content">
        <header className="safety-heading">
          <div>
            <p className="safety-eyebrow">개인정보 처리 안내 · 2026년 10월 30일</p>
            <h1>내 정보는 이렇게 사용해요</h1>
            <p>
              운영 {config.operatorName} · 문의 및 개인정보 요청 {config.supportEmail}
            </p>
          </div>
        </header>
        {!config.privacyReviewed && (
          <aside className="safety-card">
            <h2>보관 기준 보완 안내</h2>
            <p>
              아래에는 현재 서비스의 정보 이용·삭제 범위를 설명했어요. 행사·신고·거래 원장의
              보유·파기 기간과 클라우드 계약에 따른 세부 위탁·국외 처리 조건은 최종 확인 중이며,
              정식 거래 운영 전에 내용을 보완해 고지합니다. 확인·정정·삭제 요청은 지금도 이메일로
              접수할 수 있어요.
            </p>
          </aside>
        )}
        <section className="safety-card">
          <h2>1. 수집 항목·목적·보관 범위</h2>
          <div className="privacy-data-list">
            {rows.map(([name, fields, purpose, retention]) => (
              <section key={name}>
                <h3>{name}</h3>
                <dl>
                  <dt>항목</dt>
                  <dd>{fields}</dd>
                  <dt>목적</dt>
                  <dd>{purpose}</dd>
                  <dt>보관·삭제</dt>
                  <dd>{retention}</dd>
                </dl>
              </section>
            ))}
          </div>
          <p>
            선택 항목은 입력하지 않아도 기본 커뮤니티를 이용할 수 있어요. 행사 신청에 필요한 항목은
            신청 전에 안내합니다. 전화번호 입력과 QR 출석 확인은 휴대전화 소유자·본인 인증 완료를
            의미하지 않습니다.
          </p>
          <h2>2. 다른 이용자와 행사 담당자에게 보이는 정보</h2>
          <p>
            행사 담당자는 해당 행사 신청자의 닉네임·연락처·요청사항·질문 답변을 신청 관리와 진행에
            필요한 범위에서 확인합니다. 공지방 참가자는 서로의 사진·닉네임과 참가 인원을 볼 수
            있지만 연락처와 신청 답변은 볼 수 없습니다. 공개 플레이어 화면에 연락처·전화 인증
            상태·계정 식별자를 표시하지 않습니다. 행사 기록의 개인 경력은 본인의 공개 선택을
            따릅니다.
          </p>
          <p>
            자기소개 게임의 MBTI는 참가자가 직접 선택합니다. 게임 중에는 본인 정보와 본인의
            정답·오답 개수만 볼 수 있으며, 정답자가 나오거나 지정한 마지막 라운드를 마치면 시작
            참가자들의 MBTI를 해당 방에 공개합니다. 입력 화면에서 이 공개 방식을 안내합니다.
          </p>
          <h2>3. 서비스 제공업체와 외부 처리</h2>
          <ul>
            <li>Ncloud: 웹사이트·알림·영상 처리 서버 운영.</li>
            <li>Supabase: 서울 프로젝트의 DB·계정 인증·비공개 파일 저장·실시간 갱신.</li>
            <li>Google·Kakao: 이용자가 선택한 소셜 로그인.</li>
            <li>
              네이버 Maps: 주소 검색·장소 선택·지도 표시. 기기 위치는 허용한 경우 탐색에 이용하며
              공개 프로필에 표시하지 않습니다.
            </li>
            <li>이메일 서비스: 이용자가 이메일 문의를 보낼 때 해당 메일 서비스에서 처리합니다.</li>
          </ul>
          <p>
            외부 제공업체의 하위 처리·지원 범위와 국외 처리의 구체적인 항목·국가·시점·보관 조건은
            계약 확인 후 보완합니다. 별도 동의가 필요한 경우 해당 기능 이용 전에 안내합니다.
          </p>
          <h2>4. 쿠키·알림·선택 권한</h2>
          <p>
            로그인 유지에 필요한 쿠키를 사용합니다. 기기 알림은 권한 허용 후 발송하고, 위치·카메라는
            해당 기능을 사용할 때 요청합니다. 브라우저·기기 설정에서 권한을 철회할 수 있으며
            마이페이지에서 알림 항목과 구독을 관리할 수 있습니다.
          </p>
          <p>
            Google AdSense 사이트 확인과 광고 기능을 위해 공통 코드를 불러오며, Google과 광고
            파트너가 광고 제공·측정을 위해 쿠키·IP 주소·기기 정보 등을 사용할 수 있습니다. 실제 광고
            단위의 게재는 별도로 활성화합니다.
          </p>
          <div className="safety-links">
            <a
              href="https://policies.google.com/technologies/partner-sites"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google 파트너 정보 이용 안내
            </a>
            <a href="https://myadcenter.google.com/" target="_blank" rel="noopener noreferrer">
              Google 광고 설정
            </a>
          </div>
          <h2>5. 권리 행사·파기와 안전 조치</h2>
          <p>
            정보 열람·정정·삭제·처리정지와 동의 철회는 마이페이지·계정 설정 또는 공개 문의 이메일로
            요청할 수 있습니다. 접수 후 요청인과 대상 정보를 필요한 최소 범위에서 확인합니다. 법령에
            따라 보관할 필요가 있는 경우에는 보관 항목·근거·기간과 요청 처리 결과를 안내합니다.
          </p>
          <p>
            연락처·비공개 파일은 권한이 있는 담당자만 접근하도록 제한하고, 원본 데이터는 DB와 비공개
            파일 저장소에 보관합니다. 파기 시 DB의 대상 정보와 관련 파일·연결을 정리하며 백업 사본의
            반영 여부도 함께 확인합니다. 신청·신고·거래 원장의 자동 일괄 파기가 모두 구현된 것은
            아니므로 계정 탈퇴를 전체 정보의 즉시 삭제로 해석하지 말아주세요.
          </p>
          <h2>6. 변경과 연락처</h2>
          <p>
            운영자와 개인정보 요청 담당은 {config.operatorName}입니다. 중요한 정보 처리 변경은 적용
            전에 안내하고, 추가 동의가 필요한 경우 별도로 요청합니다.
          </p>
          <Link href="/settings/account">계정·안전 설정</Link>
        </section>
        <OperatorContact />
      </article>
    </ParticipationShell>
  );
}
