import Link from "next/link";
import { ParticipationShell } from "@/components/participation-shell";
import { OperatorContact } from "@/components/operator-contact";
export default function Page() {
  return (
    <ParticipationShell advertising={false}>
      <div className="safety-page">
        <header className="safety-heading">
          <div>
            <p className="safety-eyebrow">도움이 필요할 때</p>
            <h1>문의와 개인정보 요청</h1>
            <p>계정에 접속할 수 없어도 도움을 요청할 수 있어요.</p>
          </div>
        </header>
        <OperatorContact />
        <section className="safety-card">
          <h2>사이트에서 문의하고 답변 확인하기</h2>
          <p>로그인한 회원은 문의를 작성하고 기존 문의의 답변을 확인할 수 있어요.</p>
          <Link href="/support/inbox" className="support-inbox-link">
            내 문의와 답변
          </Link>
        </section>
      </div>
    </ParticipationShell>
  );
}
