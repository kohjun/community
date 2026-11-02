import Link from "next/link";
import { ParticipationShell } from "@/components/participation-shell";
import { OperatorContact } from "@/components/operator-contact";
import { readSiteOperations } from "@/domain/site-operations";
import { publicPageMetadata } from "@/domain/search-visibility";
export const dynamic = "force-dynamic";
export function generateMetadata() {
  return publicPageMetadata("/policies/terms");
}
export default function Page() {
  const config = readSiteOperations(process.env);
  return (
    <ParticipationShell advertising={false}>
      <article className="safety-page policy-content">
        <header className="safety-heading">
          <div>
            <p className="safety-eyebrow">2026년 10월 29일 안내</p>
            <h1>서비스 이용약관</h1>
            <p>함께 만들고 참여하는 Sliper의 기본 이용 기준이에요.</p>
          </div>
        </header>
        <section className="safety-card">
          <h2>1. 서비스와 운영자</h2>
          <p>
            {config.operatorName}은 Sliper의 커뮤니티·모임 안내·참가 관리·자료 공유 기능을
            운영합니다. 구체적인 모임 진행과 제공 내용은 각 주최자가 안내합니다. 운영자의 책임이
            있는 경우 관련 법령에 따른 책임을 부담합니다.
          </p>
          <h2>2. 계정과 정보</h2>
          <p>
            본인이 관리하는 소셜 계정으로 이용하고, 신청·연락에 필요한 정보는 정확하게 입력해주세요.
            다른 사람의 계정 사용, 사칭과 허위 정보 등록은 제한합니다. 전화번호 입력과 현장 QR
            확인은 신원 인증을 대신하지 않습니다.
          </p>
          <h2>3. 게시물과 자료의 권리</h2>
          <p>
            작성한 콘텐츠의 권리는 작성자에게 있습니다. 작성자는 서비스 내 표시와 기능 제공에 필요한
            범위에서 콘텐츠 이용을 허용합니다. 타인의 사진·영상·저작물을 등록할 때는 필요한 권리를
            확보해야 합니다. 자료를 재사용할 때는 작성자가 표시한 이용 조건을 확인해주세요.
          </p>
          <h2>4. 모임 참여와 안전</h2>
          <p>
            주최자는 장소·일정·참가 조건·비용·취소 조건을 정확하게 안내하고 변경 사항을 참가자에게
            알려야 합니다. 참가자는 다른 사람의 안전과 개인정보를 존중하고, 불참 시 담당자에게
            알려주세요.
          </p>
          <h2>5. 거래와 취소</h2>
          <p>
            외부 플랫폼에서 거래한 경우 해당 플랫폼의 결제·환불 절차와 행사 안내를 함께 확인합니다.
            Sliper의 외부 결제 자동 연동과 사업자 정보는 준비 중이며, 정식 거래 운영 조건은 별도
            고지합니다. 관련 법령에 따른 이용자의 권리는 제한되지 않습니다.
          </p>
          <Link href="/policies/refunds">취소·환불 안내</Link>
          <h2>6. 신고·이용 제한과 정정</h2>
          <p>
            불법 콘텐츠·사칭·차별·괴롭힘 등은 신고할 수 있습니다. 운영자는 사유와 조치 내용을
            안내하고 이용을 제한할 수 있으며, 당사자는 문의를 통해 정정·재검토를 요청할 수 있습니다.
            긴급한 위험이나 위법 콘텐츠는 먼저 노출을 제한할 수 있습니다.
          </p>
          <Link href="/policies/community">커뮤니티 이용규칙</Link>
          <h2>7. 탈퇴와 서비스 변경</h2>
          <p>
            계정·안전 설정에서 탈퇴할 수 있습니다. 탈퇴만으로 과거 작성물과 행사·거래 기록이 모두
            삭제되지는 않으므로 공개 범위와 삭제 요청 방법을 확인해주세요. 중요한 서비스·이용 기준
            변경은 적용 전에 안내합니다.
          </p>
          <Link href="/policies/privacy">개인정보 처리 안내</Link>
          <h2>8. 문의와 분쟁</h2>
          <p>
            계정에 접속할 수 없는 경우에도 공개 문의 이메일로 연락할 수 있습니다. 관련 법령에 따른
            분쟁 해결 절차와 이용자의 권리를 따릅니다.
          </p>
        </section>
        <OperatorContact />
      </article>
    </ParticipationShell>
  );
}
