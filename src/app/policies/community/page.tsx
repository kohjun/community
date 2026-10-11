import Link from "next/link";
import { ParticipationShell } from "@/components/participation-shell";
import { POLICY_VERSION } from "@/domain/safety";
export default function Page() {
  return (
    <ParticipationShell>
      <div className="safety-page policy-content">
        <div className="safety-heading">
          <div>
            <p className="safety-eyebrow">운영 기준 · {POLICY_VERSION}</p>
            <h1>함께 지키는 이용규칙</h1>
            <p>서로의 취향을 존중하고, 약속한 모임을 책임 있게 만들어가요.</p>
          </div>
        </div>
        <section className="safety-card">
          <h2>이야기를 나눌 때</h2>
          <ul>
            <li>욕설·괴롭힘·차별·위협과 타인의 개인정보 공개를 금지합니다.</li>
            <li>익명 작성도 같은 규칙을 따릅니다. 익명 작성자의 계정 정보는 공개하지 않습니다.</li>
            <li>반복 광고·도배·허위 사실이나 사기성 모집을 올리지 않습니다.</li>
            <li>직접 만든 자료나 공유 권한이 있는 사진·룰북을 올려주세요.</li>
          </ul>
          <h2>행사를 주최하고 참여할 때</h2>
          <ul>
            <li>주최자는 장소·일정·비용·진행 방식과 참가 조건을 정확하게 안내해야 합니다.</li>
            <li>일정 변경이나 취소는 참가자에게 공지하고 신청·결제 처리 상태를 확인해주세요.</li>
            <li>
              참가자의 연락처와 신청 답변은 행사 진행 목적에만 사용하고 외부에 공개하지 않습니다.
            </li>
            <li>
              참석하지 못하면 미리 취소·연락해주세요. 기록에 이의가 있다면 정정을 요청할 수
              있습니다.
            </li>
          </ul>
          <h2>신고와 운영 조치</h2>
          <p>
            운영자는 신고 내용과 콘텐츠를 검토해 위반 없음, 경고, 콘텐츠 숨김 또는 일정 기간 이용
            제한으로 처리합니다. 신고 횟수만으로 자동 제재하지 않습니다. 조치 사유와 처리 이력을
            남기고, 잘못된 숨김이나 이용 제한은 검토 후 해제할 수 있습니다.
          </p>
          <p>
            신고자가 제출한 내용은 운영자만 확인합니다. 허위·악의적인 반복 신고도 검토 대상입니다.
          </p>
          <div className="safety-links">
            <Link href="/settings/account">내 신고 진행 상황</Link>
            <Link href="/support">문의·이의신청</Link>
            <Link href="/policies/privacy">개인정보 안내</Link>
          </div>
        </section>
      </div>
    </ParticipationShell>
  );
}
