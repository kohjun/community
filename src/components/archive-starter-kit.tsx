import Link from "next/link";
const guides = [
  {
    file: "first-meeting-checklist.md",
    title: "첫 모임 체크리스트",
    detail: "모집 전부터 현장·마무리까지 확인할 항목",
  },
  {
    file: "mc-opening-cues.md",
    title: "진행자 오프닝 큐시트",
    detail: "처음 온 참가자를 위한 10분 안내와 멘트",
  },
  {
    file: "event-retrospective.md",
    title: "다음 회차 회고 양식",
    detail: "질문·후기·운영 변경을 다음 모임에 연결",
  },
];
export function ArchiveStarterKit() {
  return (
    <section className="maturity-panel" aria-labelledby="starter-kit-title">
      <p className="safety-eyebrow">Team sliper · 무료 운영 도구</p>
      <h2 id="starter-kit-title">첫 진행에 바로 써보세요</h2>
      <p>
        운영자가 새로 작성한 기본 양식이에요. 실제 행사 실적이나 검증된 게임 룰북은 아니며, 현장에
        맞게 수정할 수 있어요.
      </p>
      <div className="starter-kit-grid">
        {guides.map((item) => (
          <a key={item.file} href={"/guides/" + item.file} download>
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
            <small>무료 · Markdown 내려받기 ↗</small>
          </a>
        ))}
      </div>
      <Link href="/hosting-guide">4주 운영 계획과 함께 활용하기 →</Link>
    </section>
  );
}
