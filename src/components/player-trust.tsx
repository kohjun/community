import Link from "next/link";
import type { PlayerSummary } from "@/domain/player";
export function PlayerTrust({
  summary,
  careerVisible,
  isMe,
}: {
  summary: PlayerSummary;
  careerVisible: boolean;
  isMe: boolean;
}) {
  const newcomer =
    careerVisible &&
    summary.attended === 0 &&
    summary.noShow === 0 &&
    summary.positive === 0 &&
    summary.negative === 0;
  return (
    <section className="maturity-panel" aria-label="매너 온도의 근거">
      <h2>{newcomer ? "이제 참가 기록을 쌓아가고 있어요" : "매너 온도는 이렇게 계산해요"}</h2>
      <p>
        {newcomer
          ? "아직 기록이 적다는 이유만으로 매너가 낮다는 뜻은 아니에요. 자기소개와 모임에 대한 관심도 함께 살펴봐주세요."
          : "활동점수·게임 실력과 별도로, 참가 확인과 같은 행사 참가자의 평가를 반영해요."}
      </p>
      <dl>
        <div className="maturity-trust-row">
          <dt>기본 온도</dt>
          <dd>36.5℃</dd>
        </div>
        <div className="maturity-trust-row">
          <dt>실제 참가 완료</dt>
          <dd>{careerVisible ? `${summary.attended}회 × +0.1℃` : "전적 비공개 · 계산에는 반영"}</dd>
        </div>
        <div className="maturity-trust-row">
          <dt>긍정 평가</dt>
          <dd>{summary.positive}개 × +0.2℃</dd>
        </div>
        <div className="maturity-trust-row">
          <dt>불편 평가</dt>
          <dd>{summary.negative}개 × −0.5℃</dd>
        </div>
        <div className="maturity-trust-row">
          <dt>담당자 확인 미참석</dt>
          <dd>{summary.noShow}회 × −2℃</dd>
        </div>
      </dl>
      <p className="form-note">
        최종 온도는 0~99.9℃로 제한하고 소수 첫째 자리까지 표시해요. 샘플 행사는 제외해요. 미참석은
        담당자가 남긴 기록이며 신청 취소만으로 자동 생성되지 않아요.
      </p>
      <details>
        <summary>어떤 기록과 평가가 반영되나요?</summary>
        <p>
          같은 행사에 실제 참가가 확인된 플레이어끼리의 평가를 집계해요. 평가자의 신원과 개별 평가
          내용은 공개하지 않아요. 전적 공개 여부와 관계없이 기존 온도 계산은 유지돼요.
        </p>
        <p>
          숫자는 제한된 활동 기록의 참고값이며 신원·실력·행사 안전을 보증하지 않아요. 확인 방식별
          공식 완료 전적은 공개 동의한 포트폴리오에서 볼 수 있어요.
        </p>
      </details>
      {isMe && (
        <div className="maturity-actions">
          <Link href="/support">잘못된 참가 기록·평가 정정 요청</Link>
          <Link href="/help#record-correction">정정에 필요한 정보</Link>
        </div>
      )}
    </section>
  );
}
