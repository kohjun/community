import { publicPageMetadata } from "@/domain/search-visibility";
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
            <li>상대를 모욕하는 심한 욕설, 반복적인 괴롭힘과 협박을 금지합니다.</li>
            <li>
              성별·성적 지향·인종·국적·출신 지역 등을 이유로 특정 집단을 비하하거나 배척하는 표현을
              금지합니다.
            </li>
            <li>
              음란물, 노골적인 성행위·성기 노출 이미지와 영상, 성매매·성적 만남을 유도하는 모집을
              금지합니다. 미성년자를 성적으로 대상화하는 콘텐츠도 허용하지 않습니다.
            </li>
            <li>다른 사람의 연락처·주소·신상과 동의받지 않은 사적인 사진을 공개하지 않습니다.</li>
            <li>익명 작성도 같은 규칙을 따릅니다. 익명 작성자의 계정 정보는 공개하지 않습니다.</li>
            <li>반복 광고·도배·허위 사실이나 사기성 모집을 올리지 않습니다.</li>
            <li>직접 만든 자료나 공유 권한이 있는 사진·룰북을 올려주세요.</li>
          </ul>
          <h2>정상적인 이야기와 표현</h2>
          <p>
            연애·소개팅 행사 소개, 참가 조건이나 성비 안내, 예능 프로그램에 대한 정당한 비평은
            허용합니다. 특정 단어가 포함되었다는 이유만으로 차별이나 음란 콘텐츠로 판단하지
            않습니다. 상대방이나 집단을 모욕하지 않는 방식으로 의견을 나눠주세요.
          </p>
          <h2>등록 전 검사와 사람의 검토</h2>
          <p>
            글과 댓글을 등록하거나 수정할 때 명백한 금칙 표현을 간단한 텍스트 규칙으로 확인합니다.
            등록이 막히면 입력한 내용은 작성창에 남으므로 안내된 표현을 고쳐 다시 제출할 수
            있습니다. 정상적인 표현이 막혔다면 문의·도움에서 검토를 요청해주세요.
          </p>
          <p>
            자동 검사는 모든 우회 표현이나 문맥을 판별하지 못합니다. 이미지·영상·외부 링크 속 내용과
            판단이 어려운 표현은 신고를 바탕으로 운영자가 확인합니다. 이미지와 영상을 자동으로 전부
            판별하거나 모든 업로드를 사전 승인하는 방식은 사용하지 않습니다.
          </p>
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
            사진이나 영상 속 문제는 위치나 재생 시간을 함께 적어 신고해주세요. 신고자가 제출한
            내용은 운영자만 확인합니다. 허위·악의적인 반복 신고도 검토 대상입니다. 조치에 이의가
            있다면 내 조치 확인·이의신청에서 재검토를 요청할 수 있습니다.
          </p>
          <div className="safety-links">
            <Link href="/settings/account">내 신고 진행 상황</Link>
            <Link href="/support">문의·도움</Link>
            <Link href="/settings/appeals">내 조치 확인·이의신청</Link>
            <Link href="/policies/privacy">개인정보 안내</Link>
          </div>
        </section>
      </div>
    </ParticipationShell>
  );
}

export function generateMetadata() {
  return publicPageMetadata("/policies/community");
}
