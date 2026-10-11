import Link from "next/link";
import { ParticipationShell } from "@/components/participation-shell";
export default function Page() {
  return (
    <ParticipationShell>
      <div className="safety-page policy-content">
        <div className="safety-heading">
          <div>
            <p className="safety-eyebrow">행사 신청 안내</p>
            <h1>취소와 환불</h1>
            <p>신청 전 행사 일정과 외부 결제 플랫폼의 안내를 함께 확인해주세요.</p>
          </div>
        </div>
        <section className="safety-card">
          <h2>슬리퍼 환불 기준</h2>
          <p>
            한국 시간의 달력 날짜를 기준으로 행사 시작일까지 남은 날짜에 따라 계산합니다. 같은 날짜
            안에서는 신청 취소 시각과 관계없이 같은 비율이 적용됩니다.
          </p>
          <ul>
            <li>5일 이상 전: 100%</li>
            <li>4일 전: 80%</li>
            <li>3일 전: 60%</li>
            <li>2일 전: 40%</li>
            <li>1일 전: 20%</li>
            <li>행사 당일 및 이후: 0%</li>
          </ul>
          <h2>외부 플랫폼에서 결제한 경우</h2>
          <p>
            실제 결제와 환불은 외부 플랫폼에서 처리합니다. 슬리퍼의 환불 요청·금액 안내·처리 기록
            자체가 외부 결제 취소를 실행하지는 않습니다. 담당자가 실제 환불을 확인한 뒤 신청 상태와
            공지방 입장 권한이 갱신됩니다.
          </p>
          <h2>주최자 취소·일정 변경·결제 오류</h2>
          <p>
            참가자 개인 취소와 구분해 담당자에게 처리 방법을 확인해주세요. 결제했지만 참가가
            확정되지 않았거나 환불 확인이 지연되면 행사 이름과 외부 주문번호를 적어 문의할 수
            있습니다.
          </p>
          <div className="safety-links">
            <Link href="/participation">내 신청·환불 현황</Link>
            <Link href="/support">결제·환불 문의</Link>
            <Link href="/policies/community">이용규칙</Link>
          </div>
        </section>
      </div>
    </ParticipationShell>
  );
}
