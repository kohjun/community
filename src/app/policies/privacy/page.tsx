import Link from "next/link";
import { ParticipationShell } from "@/components/participation-shell";
import { POLICY_VERSION } from "@/domain/safety";
export default function Page() {
  return (
    <ParticipationShell>
      <div className="safety-page policy-content">
        <div className="safety-heading">
          <div>
            <p className="safety-eyebrow">정보 이용 안내 · {POLICY_VERSION}</p>
            <h1>내 정보는 이렇게 사용해요</h1>
            <p>프로필 공개 정보와 행사 진행에 필요한 정보를 구분합니다.</p>
          </div>
        </div>
        <section className="safety-card">
          <h2>로그인과 프로필</h2>
          <p>
            소셜 로그인으로 계정을 식별하고 닉네임·연락처와 선택한 프로필 정보를 저장합니다.
            연락처·전화 인증 상태·계정 식별자는 공개 플레이어 화면에 표시하지 않습니다. 전화번호
            입력은 소유자 인증을 의미하지 않습니다.
          </p>
          <h2>행사 신청 정보</h2>
          <p>
            신청 시 확인한 닉네임·연락처·요청사항·행사 질문 답변은 해당 행사 담당자가 신청 관리와
            행사 진행을 위해 확인합니다. 참가자끼리는 공지방에서 프로필 사진과 닉네임을 볼 수 있으며
            연락처와 신청 답변은 볼 수 없습니다.
          </p>
          <h2>알림과 위치</h2>
          <p>
            이 기기에서 알림을 받도록 설정하면 알림 발송에 필요한 기기 구독 정보를 저장합니다. 수신
            항목을 변경하거나 연결을 해제할 수 있습니다. 위치 기반 탐색은 기기에서 허용한 위치를
            검색에 이용하며 정확한 현재 위치를 공개 프로필에 표시하지 않습니다.
          </p>
          <h2>신고와 문의</h2>
          <p>
            신고 대상 콘텐츠의 접수 당시 사본, 신고 사유, 문의 내용과 답변을 보관하며 운영 권한이
            있는 담당자와 작성자에게 필요한 범위로 제공합니다. 비밀번호나 결제카드 정보는 제출하지
            마세요.
          </p>
          <h2>서비스 이용 현황</h2>
          <p>
            서비스 개선을 위해 로그인한 회원의 방문 날짜를 한국 시간으로 하루 한 번 기록합니다. 방문
            날짜는 90일 범위로 집계하며 이후 수집 시 만료 자료를 정리하고 탈퇴 시 삭제합니다.
            본문·연락처·좌표·기기 식별자는 이 기록에 포함하지 않습니다. 관리자는 기존
            가입·신청·출석·후기와 함께 합계만 확인합니다.
          </p>
          <h2>외부 광고 서비스</h2>
          <p>
            Google AdSense 광고를 활성화한 공개 화면에서는 Google과 광고 파트너가 광고 제공·측정을
            위해 쿠키, 웹 비콘, IP 주소와 기기 식별자 등을 이용할 수 있습니다. 외부 광고 서비스의
            정보 이용과 개인 맞춤 광고 설정은 아래 안내에서 확인할 수 있습니다.
          </p>
          <p>
            <a
              href="https://policies.google.com/technologies/partner-sites"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google의 파트너 사이트 정보 이용 안내
            </a>
            {" · "}
            <a href="https://myadcenter.google.com/" target="_blank" rel="noopener noreferrer">
              Google 광고 설정
            </a>
          </p>
          <h2>탈퇴와 삭제</h2>
          <p>
            탈퇴하면 프로필 연락처·소개·관심사·프로필 사진 연결과 푸시 구독 정보를 지우고 계정
            이용을 제한합니다. 과거 신청 연락처·답변, 작성한 글·댓글과 행사·결제 처리 기록은 함께
            삭제되지 않으며 공개 작성자 이름은 ‘탈퇴한 회원’으로 표시됩니다. 공개를 원하지 않는
            콘텐츠는 탈퇴 전에 삭제하거나 삭제를 문의해주세요.
          </p>
          <p>정보 확인·정정·삭제에 관한 요청은 문의하기에서 접수할 수 있습니다.</p>
          <Link href="/support">정보 관련 문의하기 →</Link>
        </section>
      </div>
    </ParticipationShell>
  );
}
