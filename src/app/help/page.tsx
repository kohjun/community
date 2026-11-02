import { publicPageMetadata } from "@/domain/search-visibility";
import Link from "next/link";
import { ParticipationShell } from "@/components/participation-shell";
export default function Page() {
  return (
    <ParticipationShell>
      <div className="safety-page policy-content">
        <div className="safety-heading">
          <div>
            <p className="safety-eyebrow">처음 오셨나요?</p>
            <h1>슬리퍼 이용 안내</h1>
            <p>취향을 나누고, 함께 놀고, 다음 모임을 만들어보세요.</p>
          </div>
        </div>
        <section className="safety-card">
          <h2 id="first-participation">1. 이번 주 함께 놀기</h2>
          <p>
            모집글과 신청 화면에서 초보 참여 여부·혼자 참여·활동 강도·첫 만남 안내를 확인해요. 사전
            결제가 없는 번개도 식비나 장소 이용료가 생길 수 있으니 예상 현장 비용을 확인해주세요.
            번개는 참가 요청 후 담당자가 승인해야 공지방에 입장할 수 있어요.
          </p>
          <p>
            관심 카테고리와 위치·일정·참가비로 이벤트를 찾아보세요. 가볍게 시작하고 싶다면 번개
            모임을 둘러보세요.
          </p>
          <div className="safety-links">
            <Link href="/">이벤트 찾기</Link>
            <Link href="/lightning">번개 모임</Link>
            <Link href="/map">이벤트 맵</Link>
          </div>
          <h2>2. 신청하고 공지 확인하기</h2>
          <p>
            사이트 신청은 내 프로필 정보와 행사 질문에 대한 답변으로 진행합니다. 외부 신청 링크가
            있는 행사는 해당 플랫폼에서 신청·결제한 뒤 담당자 확인 또는 연동 승인으로 참가가
            확정됩니다.
          </p>
          <p>
            참가가 확정되면 행사 전용 공지방에 입장할 수 있어요. 담당자만 메시지를 보내며 참가자는
            공지와 참가자 목록을 확인합니다.
          </p>
          <Link href="/participation">내 참가 현황·공지방 →</Link>
          <h2>3. 내 아이디어로 이벤트 만들기</h2>
          <p>
            아카이브에서 룰북의 시나리오와 진행 가이드를 참고하거나, 이벤트 템플릿으로
            장소·일정·참가비를 설정해 모집해보세요.
          </p>
          <div className="safety-links">
            <Link href="/archive">아카이브 둘러보기</Link>
            <Link href="/management">내 행사 관리</Link>
            <Link href="/hosting-guide">첫 호스트·4주 운영 가이드</Link>
          </div>
          <h2>4. 함께할 사람과 팀 찾기</h2>
          <p>
            플레이어·크루에서 개인의 취향과 참가 경험을 살펴보거나, 크루 탭으로 함께 활동할 팀을
            찾아보세요. 마음에 드는 크루에 가입을 신청하거나 직접 팀을 만들 수 있어요.
          </p>
          <div className="safety-links">
            <Link href="/players">플레이어·크루 둘러보기</Link>
          </div>
          <h2 id="handling">안심하고 이용하기</h2>
          <p>
            신고·문의는 접수 후 운영자가 확인하고 결과를 등록해요. 접수 상태는 아직 결과가 없다는
            뜻이며, 실제 검토 시작 시각이나 답변 시간을 보장하지 않아요. 처리 안내에 추가 설명이
            필요하면 문의 번호와 근거를 함께 보내주세요.
          </p>
          <h3>담당자와 연락이 닿지 않거나 행사가 중단됐나요?</h3>
          <p>
            참가 현황과 공지방에서 변경 공지를 확인한 뒤, 도움 요청하기의 행사·일정 항목에 행사
            링크·발생 시각·연락 시도와 필요한 도움을 적어주세요. 운영팀이 상시 현장 대응을 제공하는
            것은 아니에요.
          </p>
          <h3 id="record-correction">참가 기록·평가 정정</h3>
          <p>
            도움 요청하기의 계정·이의신청 항목에 행사 링크·참가 날짜·현재 기록·정정할 내용과 근거를
            알려주세요. 다른 참가자의 연락처는 공개 글에 올리지 마세요. 운영 조치에 대한 이의신청은
            내 이용 제한 화면에서 연결된 절차로 제출할 수 있어요.
          </p>
          <p>
            글·댓글·장소·플레이어에서 신고할 수 있어요. 차단은 내 게시판 화면에 적용되며 참가한
            행사의 필수 공지는 유지됩니다. 처리 결과는 계정·안전 설정에서 확인하세요.
          </p>
          <div className="safety-links">
            <Link href="/settings/account">계정·안전 설정</Link>
            <Link href="/policies/community">커뮤니티 이용규칙</Link>
            <Link href="/policies/refunds">취소·환불 안내</Link>
            <Link href="/support">도움 요청하기</Link>
          </div>
        </section>
        <section className="safety-card">
          <h2>자주 묻는 질문</h2>
          <details>
            <summary>결제했는데 공지방에 들어갈 수 없어요.</summary>
            <p>
              참가 현황에서 승인 상태를 확인하고 외부 결제 확인 요청을 제출해주세요. 해결되지 않으면
              행사 이름과 외부 플랫폼 주문번호로 문의하세요. 카드 정보는 보내지 마세요.
            </p>
          </details>
          <details>
            <summary>푸시 알림이 오지 않아요.</summary>
            <p>
              내 정보의 알림 설정에서 이 기기를 연결해주세요. iPhone에서는 홈 화면에 앱으로 추가한
              뒤 실행해야 합니다. 알림 권한을 거부했다면 기기의 알림 설정도 확인해주세요.
            </p>
          </details>
          <details>
            <summary>노쇼 기록이나 이용 제한에 이의가 있어요.</summary>
            <p>
              계정·안전 설정에서 사유를 확인하고, 문의하기의 ‘계정·이의신청’으로 행사 이름과 정정이
              필요한 내용을 보내주세요.
            </p>
          </details>
          <details>
            <summary>회원 탈퇴는 어떻게 하나요?</summary>
            <p>
              진행 중인 신청·환불·모집을 정리한 후 계정·안전 설정에서 탈퇴할 수 있어요. 남기고 싶지
              않은 글과 댓글은 먼저 삭제해주세요.
            </p>
          </details>
        </section>
      </div>
    </ParticipationShell>
  );
}

export function generateMetadata() {
  return publicPageMetadata("/help");
}
