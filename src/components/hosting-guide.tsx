"use client";
import Link from "next/link";
import { useState } from "react";
import { TOPICS, type TopicSlug } from "@/domain/topics";
import { pilotPlanMarkdown } from "@/domain/community-maturity";
import { ParticipationShell } from "./participation-shell";
export function HostingGuide() {
  const [region, setRegion] = useState(""),
    [hosts, setHosts] = useState(3),
    [topics, setTopics] = useState<TopicSlug[]>(["mystery"]),
    [error, setError] = useState("");
  function download() {
    try {
      const text = pilotPlanMarkdown({ region, hosts, topics });
      const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "sliper-4week-plan.md";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setError("");
    } catch {
      setError("활동 지역과 주제를 한 개 이상 선택해주세요.");
    }
  }
  return (
    <ParticipationShell>
      <div className="maturity-page">
        <Link href="/archive">← 아카이브</Link>
        <header>
          <p className="player-eyebrow">처음 여는 모임, 함께 운영하는 다음 회차</p>
          <h1>작게 시작하고, 매회 더 좋아지게</h1>
          <p>한 지역 · 주최자 3~5명 · 취향 2~3개를 중심으로 4주 동안 반복해보세요.</p>
        </header>
        <section className="maturity-panel">
          <h2>먼저 운영 범위를 정해요</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              download();
            }}
          >
            <div className="maturity-fields">
              <label>
                활동 지역
                <input
                  required
                  maxLength={80}
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="예: 서울 마포구"
                />
              </label>
              <label>
                함께할 주최자 목표
                <select value={hosts} onChange={(e) => setHosts(Number(e.target.value))}>
                  {[3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}명
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset>
              <legend>집중할 취향</legend>
              <div className="maturity-actions">
                {TOPICS.map((t) => (
                  <button
                    type="button"
                    key={t.slug}
                    aria-pressed={topics.includes(t.slug)}
                    onClick={() =>
                      setTopics(
                        topics.includes(t.slug)
                          ? topics.filter((v) => v !== t.slug)
                          : [...topics, t.slug],
                      )
                    }
                  >
                    {t.title}
                  </button>
                ))}
              </div>
            </fieldset>
            <p className="form-note">
              지역·인원은 운영 초안이에요. 실제 주최자 동의를 받은 뒤 크루를 구성해주세요. 입력은 이
              화면에서만 유지되며 내려받은 계획은 직접 보관·공유할 수 있어요.
            </p>
            {error && <p role="alert">{error}</p>}
            <button type="submit" className="participation-primary">
              4주 운영 계획 내려받기
            </button>
          </form>
          <div className="maturity-actions">
            <Link href="/players?tab=crews">함께할 크루 찾기·만들기</Link>
            <Link href="/mypage?tab=events&view=hosting">내 행사 관리</Link>
          </div>
        </section>
        <section className="maturity-panel">
          <h2>4주 운영 순서</h2>
          <ol className="maturity-steps">
            <li>
              <h3>준비 주 · 한 지역에서 팀 만들기</h3>
              <p>
                동의한 주최자 3~5명이 주최·현장 보조·문의 담당을 나누고, 장소와 예상 비용을
                확인해요.
              </p>
            </li>
            <li>
              <h3>1주 · 처음 온 사람의 경험 듣기</h3>
              <p>
                작은 모임을 열고 출석을 확인해요. 행사를 완료한 뒤 자주 나온 질문과 인증 후기를 함께
                살펴봐요.
              </p>
              <Link href="/lightning">번개 열기 →</Link>
            </li>
            <li>
              <h3>2주 · 한 가지 바꿔 다시 진행하기</h3>
              <p>
                회고의 개선점 하나를 다음 모집 안내·규칙에 반영해요. 이전 행사와 재사용 자료를
                연결해요.
              </p>
              <Link href="/mypage?tab=events&view=hosting">완료 확인·회고·재개최 →</Link>
            </li>
            <li>
              <h3>3주 · 다른 호스트가 자료 재사용하기</h3>
              <p>
                같은 자료를 다른 사람이 진행해보고, 준비가 어려웠던 부분을 수정 제안으로 남겨요.
              </p>
              <Link href="/archive?used=true">운영 사례가 있는 자료 →</Link>
            </li>
            <li>
              <h3>4주 · 다음 달의 운영 결정하기</h3>
              <p>
                완료 기록과 후기에서 유지할 점·바꿀 점·중단할 점을 정해요. 신청 수와 실제 참가 수를
                구분해요.
              </p>
              <Link href="/archive?tab=records">완료 행사 기록 →</Link>
            </li>
          </ol>
        </section>
        <section className="maturity-panel">
          <h2>매회 세 문장만 남겨도 좋아요</h2>
          <p>① 참가자가 가장 많이 물은 질문은 무엇이었나요?</p>
          <p>② 실제로 잘된 점과 어려웠던 점은 무엇인가요?</p>
          <p>③ 다음 회차에서 무엇을 하나 바꾸고 누가 확인하나요?</p>
          <p className="form-note">
            회고는 내 행사에서 작성해 회원에게 공개할 수 있어요. 연락처와 참가 신청 답변은 공개
            회고에 옮기지 마세요.
          </p>
        </section>
        <section className="maturity-panel">
          <h2>나에게 맞는 첫 진행 자료</h2>
          <div className="maturity-actions">
            <Link href="/archive?difficulty=easy&maxStaff=0">추가 스태프 없이 준비하기</Link>
            <Link href="/archive?players=6&maxDurationMinutes=90">6명·90분 이내 자료</Link>
            <Link href="/archive?used=true">회원이 볼 수 있는 실제 운영 사례</Link>
          </div>
          <p>
            조건은 작성자가 입력한 공개 정보예요. 자료 상세에서 규칙·준비물·이용 조건을 확인하고
            필요하면 작성자에게 질문해주세요.
          </p>
        </section>
      </div>
    </ParticipationShell>
  );
}
