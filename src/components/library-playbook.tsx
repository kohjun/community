"use client";
import { useId, useState, type KeyboardEvent } from "react";
import {
  BookOpen,
  CalendarClock,
  ChevronDown,
  Flag,
  Layers3,
  MapPin,
  Users,
  Wallet,
} from "lucide-react";
import type { LibraryPayload } from "@/domain/library";
import { budgetShare, budgetTotal, CUE_PHASES, MISSION_KINDS } from "@/domain/event-plan";
import { Markdown } from "./markdown";
import { LibraryChecklist, LibraryTimer } from "./library-timer";

const tabs = [
  { id: "overview", label: "개요·기획", icon: BookOpen },
  { id: "missions", label: "미션·규칙", icon: Flag },
  { id: "operations", label: "타임라인·진행", icon: CalendarClock },
  { id: "budget", label: "준비물·예산", icon: Wallet },
] as const;
const money = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;
function TextBlock({ title, children }: { title: string; children?: string | undefined }) {
  if (!children) return null;
  return (
    <section className="playbook-section">
      <h3>{title}</h3>
      <Markdown>{children}</Markdown>
    </section>
  );
}
export function LibraryPlaybook({
  payload,
  summary,
}: {
  payload: LibraryPayload;
  summary?: string;
}) {
  const [active, setActive] = useState<(typeof tabs)[number]["id"]>("overview");
  const [query, setQuery] = useState("");
  const [missionKind, setMissionKind] = useState("all");
  const prefix = "playbook-" + useId();
  const plan = payload.eventPlan,
    reference = plan?.reference;
  const hasReference =
    reference && Object.values(reference).some((value) => value !== "" && value !== null);
  const total = budgetTotal(plan?.budget ?? []);
  const missions =
    plan?.missions.filter(
      (m) =>
        (missionKind === "all" || m.kind === missionKind) &&
        `${m.name} ${m.zone} ${m.summary}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
    ) ?? [];
  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    setActive(tabs[next]!.id);
    document.getElementById(`${prefix}-tab-${tabs[next]!.id}`)?.focus();
  }
  return (
    <div className="library-playbook">
      <div className="playbook-heading">
        <div>
          <span className="playbook-eyebrow">운영 가이드</span>
          <h2>필요한 정보부터 살펴보세요</h2>
        </div>
        {plan && (plan.missions.length > 0 || plan.timeline.length > 0) && (
          <span className="playbook-completeness">
            미션 {plan.missions.length}개 · 진행 순서 {plan.timeline.length}개
          </span>
        )}
      </div>
      <div className="playbook-tabs" role="tablist" aria-label="운영 가이드 목차">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`${prefix}-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            aria-controls={`${prefix}-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            onKeyDown={(e) => moveTab(e, index)}
            onClick={() => setActive(tab.id)}
          >
            <tab.icon size={17} aria-hidden="true" />
            {tab.label}
          </button>
        ))}
      </div>
      <section
        className="playbook-panel"
        id={`${prefix}-overview`}
        role="tabpanel"
        aria-labelledby={`${prefix}-tab-overview`}
        hidden={active !== "overview"}
        tabIndex={0}
      >
        {summary && <TextBlock title="이벤트 요약">{summary}</TextBlock>}
        {reference && hasReference && (
          <section className="playbook-section">
            <div className="playbook-section-heading">
              <h3>이벤트 개요</h3>
              <span>운영 예시</span>
            </div>
            <dl className="playbook-facts">
              {reference.organizer && (
                <div>
                  <dt>기획·진행</dt>
                  <dd>{reference.organizer}</dd>
                </div>
              )}
              {reference.date && (
                <div>
                  <dt>날짜</dt>
                  <dd>
                    <time dateTime={reference.date}>{reference.date.replaceAll("-", ". ")}</time>
                  </dd>
                </div>
              )}
              {(reference.startTime || reference.endTime) && (
                <div>
                  <dt>진행 시간</dt>
                  <dd>
                    {reference.startTime || "미입력"} ~ {reference.endTime || "미입력"}
                  </dd>
                </div>
              )}
              {reference.location && (
                <div>
                  <dt>
                    <MapPin size={13} /> 장소
                  </dt>
                  <dd>{reference.location}</dd>
                </div>
              )}
              {reference.participants !== null && (
                <div>
                  <dt>
                    <Users size={13} /> 참가 인원
                  </dt>
                  <dd>
                    {reference.participants}명 <small>작성자 입력</small>
                  </dd>
                </div>
              )}
              {reference.participantFeeKRW !== null && (
                <div>
                  <dt>행사 참가비</dt>
                  <dd>
                    {reference.participantFeeKRW === 0
                      ? "무료"
                      : money(reference.participantFeeKRW)}{" "}
                    <small>자료 가격과 별도</small>
                  </dd>
                </div>
              )}
            </dl>
            <p className="playbook-note">
              작성자가 입력한 운영 예시예요. Sliper에서 출석 확인한 행사 기록과는 별도이며, 다음
              모임의 일정·장소·참가비는 새로 설정해요.
            </p>
          </section>
        )}
        <TextBlock title="기획 의도와 배경">{plan?.planningIntent}</TextBlock>
        {(plan?.concept || plan?.worldbuilding) && (
          <section className="playbook-section">
            <h3>컨셉과 세계관</h3>
            {plan.concept && (
              <p className="playbook-concept">
                <Layers3 size={18} />
                {plan.concept}
              </p>
            )}
            {plan.worldbuilding && <Markdown>{plan.worldbuilding}</Markdown>}
          </section>
        )}
        {plan && (plan.format || plan.teamSize || plan.victoryCondition || plan.movementRules) && (
          <section className="playbook-section">
            <h3>콘텐츠 구조</h3>
            <div className="playbook-inline-facts">
              {plan.format && <span>{plan.format}</span>}
              {plan.teamSize && <span>팀당 {plan.teamSize}명</span>}
            </div>
            {plan.victoryCondition && (
              <div className="playbook-callout">
                <strong>
                  <Flag size={15} />
                  승리 조건
                </strong>
                <Markdown>{plan.victoryCondition}</Markdown>
              </div>
            )}
            {plan.movementRules && (
              <>
                <h4>이동·참여 방식</h4>
                <Markdown>{plan.movementRules}</Markdown>
              </>
            )}
          </section>
        )}
        <TextBlock title="행사 소개·전체 시나리오">{payload.scenario}</TextBlock>
      </section>
      <section
        className="playbook-panel"
        id={`${prefix}-missions`}
        role="tabpanel"
        aria-labelledby={`${prefix}-tab-missions`}
        hidden={active !== "missions"}
        tabIndex={0}
      >
        <TextBlock title="공통 규칙·점수·승리 조건">{payload.rules}</TextBlock>
        {!!plan?.missions.length && (
          <section className="playbook-section">
            <div className="playbook-section-heading">
              <h3>게임 상세 설명</h3>
              <span>{plan.missions.length}개 미션</span>
            </div>
            <div className="playbook-mission-filter">
              <label>
                <span className="sr-only">미션 이름·구역 검색</span>
                <input
                  type="search"
                  placeholder="미션 이름이나 구역 찾기"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <label>
                <span className="sr-only">미션 유형</span>
                <select value={missionKind} onChange={(e) => setMissionKind(e.target.value)}>
                  <option value="all">모든 미션</option>
                  {Object.entries(MISSION_KINDS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="playbook-missions">
              {missions.map((m) => {
                const index = plan.missions.indexOf(m);
                return (
                  <details className="playbook-mission" key={index}>
                    <summary>
                      <span className="playbook-mission-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <div className="playbook-mission-meta">
                          <span>{m.zone || "구역 미지정"}</span>
                          <span>{MISSION_KINDS[m.kind]}</span>
                          {m.durationMinutes && <span>{m.durationMinutes}분</span>}
                        </div>
                        <h4>{m.name}</h4>
                        {m.summary && <p>{m.summary}</p>}
                      </div>
                      <ChevronDown size={18} className="playbook-chevron" />
                    </summary>
                    <div className="playbook-mission-body">
                      <h5>게임 규칙</h5>
                      <Markdown>{m.rules}</Markdown>
                      {m.facilitatorNotes && (
                        <>
                          <h5>진행 포인트</h5>
                          <Markdown>{m.facilitatorNotes}</Markdown>
                        </>
                      )}
                      {m.scoring && (
                        <div className="playbook-callout">
                          <strong>점수·성공 조건</strong>
                          <Markdown>{m.scoring}</Markdown>
                        </div>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
            {!missions.length && (
              <p className="playbook-empty" role="status">
                조건에 맞는 미션이 없어요.
              </p>
            )}
          </section>
        )}
      </section>
      <section
        className="playbook-panel"
        id={`${prefix}-operations`}
        role="tabpanel"
        aria-labelledby={`${prefix}-tab-operations`}
        hidden={active !== "operations"}
        tabIndex={0}
      >
        {!!plan?.timeline.length && (
          <section className="playbook-section">
            <div className="playbook-section-heading">
              <h3>타임라인과 큐시트</h3>
              <span>{plan.timeline.length}개 순서</span>
            </div>
            <p className="playbook-note">
              위에서 아래로 진행해요. 시간은 작성한 기준 시점이며, 같은 시각의 동시 진행도 표시할 수
              있어요.
            </p>
            <ol className="playbook-timeline">
              {plan.timeline.map((cue, index) => (
                <li key={index}>
                  <div className="playbook-cue-time">{cue.time}</div>
                  <div className="playbook-cue-body">
                    <span className={`playbook-phase is-${cue.phase}`}>
                      {CUE_PHASES[cue.phase]}
                    </span>
                    <h4>{cue.program}</h4>
                    {cue.details && <Markdown>{cue.details}</Markdown>}
                    {cue.notes && (
                      <p className="playbook-cue-note">
                        <strong>진행 메모</strong>
                        {cue.notes}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}
        <TextBlock title="진행자 멘트·운영 가이드">{payload.hostGuide}</TextBlock>
        <LibraryTimer rounds={payload.rounds} />
      </section>
      <section
        className="playbook-panel"
        id={`${prefix}-budget`}
        role="tabpanel"
        aria-labelledby={`${prefix}-tab-budget`}
        hidden={active !== "budget"}
        tabIndex={0}
      >
        {payload.materials.length ? (
          <LibraryChecklist materials={payload.materials} />
        ) : (
          <section className="playbook-section">
            <h3>준비물 체크리스트</h3>
            <p className="playbook-empty">등록된 준비물이 아직 없어요.</p>
          </section>
        )}
        {plan && (plan.budget.length > 0 || plan.budgetNotes) && (
          <section className="playbook-section">
            <div className="playbook-budget-heading">
              <div>
                <h3>운영 예산</h3>
                <p>행사 운영에 들어가는 비용이에요.</p>
              </div>
              <div>
                <span>총 예산</span>
                <strong>{money(total)}</strong>
              </div>
            </div>
            <div className="playbook-budget-table">
              <table>
                <caption className="sr-only">운영 예산 항목별 금액과 전체 예산 비중</caption>
                <thead>
                  <tr>
                    <th scope="col">항목</th>
                    <th scope="col">세부 내역</th>
                    <th scope="col">금액</th>
                    <th scope="col">비중</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.budget.map((row, i) => (
                    <tr key={i}>
                      <th scope="row">{row.category}</th>
                      <td>{row.description || "—"}</td>
                      <td>{money(row.amountKRW)}</td>
                      <td>{budgetShare(row.amountKRW, total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={2} scope="row">
                      총 예산
                    </th>
                    <td>{money(total)}</td>
                    <td>{total > 0 ? "100%" : "—"}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {plan.budgetNotes && (
              <div className="playbook-note">
                <Markdown>{plan.budgetNotes}</Markdown>
              </div>
            )}
          </section>
        )}
      </section>
    </div>
  );
}
