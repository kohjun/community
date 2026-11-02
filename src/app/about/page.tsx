import Link from "next/link";
import { ParticipationShell } from "@/components/participation-shell";
import { OperatorContact } from "@/components/operator-contact";
import { publicPageMetadata } from "@/domain/search-visibility";
export function generateMetadata() {
  return publicPageMetadata("/about");
}
export default function Page() {
  return (
    <ParticipationShell advertising={false}>
      <article className="safety-page policy-content">
        <header className="safety-heading">
          <div>
            <p className="safety-eyebrow">슬쩍 나와서 리얼하게 노는 퍼블릭 모임</p>
            <h1>일상에 예능 한 스푼</h1>
            <p>같이 놀고, 경험을 남기고, 더 좋은 모임을 만들어요.</p>
          </div>
        </header>
        <section className="safety-card">
          <h2>취향이 맞는 사람들과 만나요</h2>
          <p>
            여행과 미션 레이스, 추리 게임부터 음악·스포츠·요리·파티까지. 처음 오는 사람도 진행
            방식과 만나는 곳을 살펴보고 신청할 수 있어요.
          </p>
          <div className="safety-links">
            <Link href="/lightning">번개 모임 찾기</Link>
            <Link href="/map">장소 둘러보기</Link>
          </div>
          <h2>한 번의 경험이 다음 모임으로</h2>
          <p>
            참가 경험과 후기, 주최자의 회고와 운영 자료를 연결해요. 공개 범위를 직접 선택하며 기록을
            다음 진행에 활용할 수 있어요.
          </p>
          <div className="safety-links">
            <Link href="/archive">기획 자료 찾기</Link>
            <Link href="/hosting-guide">처음 모임 열기</Link>
          </div>
          <h2>작게 시작하는 커뮤니티</h2>
          <p>
            한 지역과 몇 가지 취향에 집중해 모임을 반복하고, 매회 질문·후기·개선점을 다음 안내와
            진행에 반영하려고 해요. 함께할 주최자는 문의 메일로 활동 지역·관심 콘텐츠·진행 경험을
            소개해주세요.
          </p>
          <p>
            현재 외부 결제 자동 연동과 사업자 정보는 준비 중이에요. 유료 거래와 정산의 운영 조건은
            정식 안내 후 적용합니다.
          </p>
        </section>
        <OperatorContact />
      </article>
    </ParticipationShell>
  );
}
