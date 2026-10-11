"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import {
  budgetTotal,
  CUE_PHASES,
  emptyEventPlan,
  MISSION_KINDS,
  type EventPlan,
} from "@/domain/event-plan";

function Field({
  label,
  value,
  onChange,
  maxLength = 2000,
  multiline = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="marketplace-field">
      {label}
      {multiline ? (
        <textarea
          rows={3}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
function NumberField({
  label,
  value,
  onChange,
  max,
  min = 0,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  max: number;
  min?: number;
}) {
  return (
    <label className="marketplace-field">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={1}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
    </label>
  );
}
function move<T>(items: T[], index: number, direction: number): T[] {
  const next = [...items],
    target = index + direction;
  if (target < 0 || target >= next.length) return items;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
function RowActions({
  label,
  index,
  count,
  onMove,
  onRemove,
}: {
  label: string;
  index: number;
  count: number;
  onMove: (direction: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="playbook-row-actions">
      <button
        type="button"
        onClick={() => onMove(-1)}
        disabled={index === 0}
        aria-label={`${label} 위로 이동`}
      >
        <ArrowUp size={15} />
      </button>
      <button
        type="button"
        onClick={() => onMove(1)}
        disabled={index === count - 1}
        aria-label={`${label} 아래로 이동`}
      >
        <ArrowDown size={15} />
      </button>
      <button type="button" onClick={onRemove} aria-label={`${label} 삭제`}>
        <Trash2 size={15} />
        <span>삭제</span>
      </button>
    </div>
  );
}
export function EventPlanEditor({
  value,
  onChange,
}: {
  value: EventPlan | null;
  onChange: (plan: EventPlan | null) => void;
}) {
  const [expandedMission, setExpandedMission] = useState<number | null>(null);
  if (!value)
    return (
      <section className="marketplace-section playbook-editor-intro">
        <h2>항목별 운영 계획</h2>
        <p>기획 의도, 미션, 큐시트와 예산을 추가해 한눈에 읽을 수 있는 자료를 만들어요.</p>
        <button
          className="participation-secondary"
          type="button"
          onClick={() => onChange(emptyEventPlan())}
        >
          <Plus size={15} />
          상세 항목 추가
        </button>
      </section>
    );
  const plan = value;
  function patch<K extends keyof EventPlan>(key: K, next: EventPlan[K]) {
    onChange({ ...plan, [key]: next });
  }
  function reference<K extends keyof EventPlan["reference"]>(
    key: K,
    next: EventPlan["reference"][K],
  ) {
    patch("reference", { ...plan.reference, [key]: next });
  }
  function mission(index: number, changes: Partial<EventPlan["missions"][number]>) {
    patch(
      "missions",
      plan.missions.map((m, i) => (i === index ? { ...m, ...changes } : m)),
    );
  }
  return (
    <div className="playbook-editor">
      <div className="playbook-editor-title">
        <h2>항목별 운영 계획</h2>
        <p>필요한 항목만 채워도 돼요. 유료 자료는 구매 확인 후 함께 열려요.</p>
      </div>
      <details className="playbook-editor-group" open>
        <summary>
          <span>01</span>
          <div>
            <strong>이벤트 개요</strong>
            <small>기준 행사·장소·참가비</small>
          </div>
        </summary>
        <div className="playbook-editor-group-body">
          <p className="playbook-note">
            한 번 운영한 예시나 기준 행사를 적어요. 아래 인원은 출석 인증 전적에 합산되지 않아요.
          </p>
          <div className="marketplace-form-grid">
            <Field
              label="기획·진행자 표기"
              value={plan.reference.organizer}
              onChange={(v) => reference("organizer", v)}
              maxLength={80}
              placeholder="예: B팀"
            />
            <label className="marketplace-field">
              기준 행사 날짜
              <input
                type="date"
                value={plan.reference.date}
                onChange={(e) => reference("date", e.target.value)}
              />
            </label>
            <label className="marketplace-field">
              시작 시간
              <input
                type="time"
                value={plan.reference.startTime}
                onChange={(e) => reference("startTime", e.target.value)}
              />
            </label>
            <label className="marketplace-field">
              종료 시간
              <input
                type="time"
                value={plan.reference.endTime}
                onChange={(e) => reference("endTime", e.target.value)}
              />
            </label>
            <Field
              label="장소"
              value={plan.reference.location}
              onChange={(v) => reference("location", v)}
              maxLength={160}
              placeholder="예: 서울 코엑스(삼성역)"
            />
            <NumberField
              label="예시 참가 인원 (명)"
              value={plan.reference.participants}
              onChange={(v) => reference("participants", v)}
              max={5000}
              min={1}
            />
            <NumberField
              label="행사 참가비 (원 · 자료 가격과 별도)"
              value={plan.reference.participantFeeKRW}
              onChange={(v) => reference("participantFeeKRW", v)}
              max={10000000}
            />
          </div>
        </div>
      </details>
      <details className="playbook-editor-group">
        <summary>
          <span>02</span>
          <div>
            <strong>기획·컨셉·콘텐츠 구조</strong>
            <small>왜 만들었고, 어떻게 진행하나요?</small>
          </div>
        </summary>
        <div className="playbook-editor-group-body">
          <Field
            label="기획 의도와 배경"
            multiline
            value={plan.planningIntent}
            onChange={(v) => patch("planningIntent", v)}
            maxLength={4000}
            placeholder="참가자가 어떤 경험을 얻기를 바라나요?"
          />
          <Field
            label="메인 컨셉"
            value={plan.concept}
            onChange={(v) => patch("concept", v)}
            maxLength={200}
            placeholder="예: 도시 점령 레이스"
          />
          <Field
            label="세계관"
            multiline
            value={plan.worldbuilding}
            onChange={(v) => patch("worldbuilding", v)}
            maxLength={3000}
          />
          <div className="marketplace-form-grid">
            <Field
              label="진행 포맷"
              value={plan.format}
              onChange={(v) => patch("format", v)}
              maxLength={500}
              placeholder="예: 팀 기반 구역 점령 미션 레이스"
            />
            <NumberField
              label="팀당 인원 (명)"
              value={plan.teamSize}
              onChange={(v) => patch("teamSize", v)}
              min={1}
              max={5000}
            />
          </div>
          <Field
            label="최종 승리 조건"
            multiline
            value={plan.victoryCondition}
            onChange={(v) => patch("victoryCondition", v)}
            maxLength={1200}
          />
          <Field
            label="이동·참여 방식"
            multiline
            value={plan.movementRules}
            onChange={(v) => patch("movementRules", v)}
            maxLength={2000}
          />
        </div>
      </details>
      <details className="playbook-editor-group" open>
        <summary>
          <span>03</span>
          <div>
            <strong>미션별 상세 설명</strong>
            <small>{plan.missions.length} / 40개 · 미션마다 규칙과 점수를 나눠요</small>
          </div>
        </summary>
        <div className="playbook-editor-group-body">
          {plan.missions.map((m, i) => (
            <details
              className="playbook-editor-mission"
              key={i}
              open={expandedMission === i}
              onToggle={(e) => {
                if (e.currentTarget.open) setExpandedMission(i);
                else setExpandedMission((v) => (v === i ? null : v));
              }}
            >
              <summary>
                <span>{String(i + 1).padStart(2, "0")}</span>
                <strong>{m.name || "새 미션"}</strong>
                <small>{m.zone || MISSION_KINDS[m.kind]}</small>
              </summary>
              <div className="playbook-editor-group-body">
                <RowActions
                  label={`${i + 1}번 미션`}
                  index={i}
                  count={plan.missions.length}
                  onMove={(d) => {
                    patch("missions", move(plan.missions, i, d));
                    setExpandedMission(i + d);
                  }}
                  onRemove={() => {
                    patch(
                      "missions",
                      plan.missions.filter((_, n) => n !== i),
                    );
                    setExpandedMission(null);
                  }}
                />
                <div className="marketplace-form-grid">
                  <Field
                    label="미션 이름"
                    value={m.name}
                    onChange={(v) => mission(i, { name: v })}
                    maxLength={80}
                  />
                  <Field
                    label="구역·진행 장소"
                    value={m.zone}
                    onChange={(v) => mission(i, { zone: v })}
                    maxLength={60}
                    placeholder="예: 1구역 · 식품관"
                  />
                  <label className="marketplace-field">
                    유형
                    <select
                      value={m.kind}
                      onChange={(e) => mission(i, { kind: e.target.value as typeof m.kind })}
                    >
                      {Object.entries(MISSION_KINDS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <NumberField
                    label="제한 시간 (분 · 없으면 비워두기)"
                    value={m.durationMinutes}
                    onChange={(v) => mission(i, { durationMinutes: v })}
                    min={1}
                    max={1440}
                  />
                </div>
                <Field
                  label="한 줄 소개"
                  value={m.summary}
                  onChange={(v) => mission(i, { summary: v })}
                  maxLength={400}
                />
                <Field
                  label="게임 규칙"
                  multiline
                  value={m.rules}
                  onChange={(v) => mission(i, { rules: v })}
                  maxLength={3000}
                  placeholder="성공·실패·재도전 조건을 구체적으로 적어주세요."
                />
                <Field
                  label="진행 포인트·스태프 메모"
                  multiline
                  value={m.facilitatorNotes}
                  onChange={(v) => mission(i, { facilitatorNotes: v })}
                  maxLength={1500}
                />
                <Field
                  label="점수·성공 조건"
                  multiline
                  value={m.scoring}
                  onChange={(v) => mission(i, { scoring: v })}
                  maxLength={600}
                />
              </div>
            </details>
          ))}
          <button
            type="button"
            className="playbook-add"
            disabled={plan.missions.length >= 40}
            onClick={() => {
              setExpandedMission(plan.missions.length);
              patch("missions", [
                ...plan.missions,
                {
                  name: "",
                  zone: "",
                  kind: "mission",
                  summary: "",
                  rules: "",
                  facilitatorNotes: "",
                  scoring: "",
                  durationMinutes: null,
                },
              ]);
            }}
          >
            <Plus size={16} />
            미션 추가
          </button>
        </div>
      </details>
      <details className="playbook-editor-group">
        <summary>
          <span>04</span>
          <div>
            <strong>타임라인·큐시트</strong>
            <small>{plan.timeline.length} / 60개 · 준비부터 해산까지</small>
          </div>
        </summary>
        <div className="playbook-editor-group-body">
          {plan.timeline.map((cue, i) => (
            <div className="playbook-editor-row" key={i}>
              <RowActions
                label={`${i + 1}번 큐시트`}
                index={i}
                count={plan.timeline.length}
                onMove={(d) => patch("timeline", move(plan.timeline, i, d))}
                onRemove={() =>
                  patch(
                    "timeline",
                    plan.timeline.filter((_, n) => n !== i),
                  )
                }
              />
              <div className="marketplace-form-grid">
                <Field
                  label="시간·진행 시점"
                  value={cue.time}
                  onChange={(v) =>
                    patch(
                      "timeline",
                      plan.timeline.map((c, n) => (n === i ? { ...c, time: v } : c)),
                    )
                  }
                  maxLength={40}
                  placeholder="14:00 / 시작 20분 후"
                />
                <label className="marketplace-field">
                  구분
                  <select
                    value={cue.phase}
                    onChange={(e) =>
                      patch(
                        "timeline",
                        plan.timeline.map((c, n) =>
                          n === i ? { ...c, phase: e.target.value as typeof c.phase } : c,
                        ),
                      )
                    }
                  >
                    {Object.entries(CUE_PHASES).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Field
                label="프로그램"
                value={cue.program}
                onChange={(v) =>
                  patch(
                    "timeline",
                    plan.timeline.map((c, n) => (n === i ? { ...c, program: v } : c)),
                  )
                }
                maxLength={100}
              />
              <Field
                label="세부 내용"
                multiline
                value={cue.details}
                onChange={(v) =>
                  patch(
                    "timeline",
                    plan.timeline.map((c, n) => (n === i ? { ...c, details: v } : c)),
                  )
                }
                maxLength={1200}
              />
              <Field
                label="비고·담당 메모"
                value={cue.notes}
                onChange={(v) =>
                  patch(
                    "timeline",
                    plan.timeline.map((c, n) => (n === i ? { ...c, notes: v } : c)),
                  )
                }
                maxLength={600}
              />
            </div>
          ))}
          <button
            type="button"
            className="playbook-add"
            disabled={plan.timeline.length >= 60}
            onClick={() =>
              patch("timeline", [
                ...plan.timeline,
                { time: "", phase: "main", program: "", details: "", notes: "" },
              ])
            }
          >
            <Plus size={16} />
            진행 순서 추가
          </button>
        </div>
      </details>
      <details className="playbook-editor-group">
        <summary>
          <span>05</span>
          <div>
            <strong>운영 예산</strong>
            <small>
              {plan.budget.length}개 항목 · 합계 {budgetTotal(plan.budget).toLocaleString("ko-KR")}
              원
            </small>
          </div>
        </summary>
        <div className="playbook-editor-group-body">
          <p className="playbook-note">
            자료 판매 가격이나 참가비와 별도로, 운영 비용 항목을 적어요. 합계와 비중은 자동으로
            계산돼요.
          </p>
          {plan.budget.map((row, i) => (
            <div className="playbook-editor-row" key={i}>
              <RowActions
                label={`${i + 1}번 예산`}
                index={i}
                count={plan.budget.length}
                onMove={(d) => patch("budget", move(plan.budget, i, d))}
                onRemove={() =>
                  patch(
                    "budget",
                    plan.budget.filter((_, n) => n !== i),
                  )
                }
              />
              <div className="marketplace-form-grid">
                <Field
                  label="항목"
                  value={row.category}
                  onChange={(v) =>
                    patch(
                      "budget",
                      plan.budget.map((b, n) => (n === i ? { ...b, category: v } : b)),
                    )
                  }
                  maxLength={60}
                />
                <NumberField
                  label="금액 (원)"
                  value={row.amountKRW}
                  onChange={(v) =>
                    patch(
                      "budget",
                      plan.budget.map((b, n) => (n === i ? { ...b, amountKRW: v ?? 0 } : b)),
                    )
                  }
                  max={100000000}
                />
              </div>
              <Field
                label="세부 내역"
                value={row.description}
                onChange={(v) =>
                  patch(
                    "budget",
                    plan.budget.map((b, n) => (n === i ? { ...b, description: v } : b)),
                  )
                }
                maxLength={200}
              />
            </div>
          ))}
          <button
            type="button"
            className="playbook-add"
            disabled={plan.budget.length >= 60}
            onClick={() =>
              patch("budget", [...plan.budget, { category: "", description: "", amountKRW: 0 }])
            }
          >
            <Plus size={16} />
            예산 항목 추가
          </button>
          <Field
            label="예산 기준·참고 사항"
            multiline
            value={plan.budgetNotes}
            onChange={(v) => patch("budgetNotes", v)}
            maxLength={1200}
            placeholder="전체/팀별/1인당 기준, 포함되지 않은 비용 등을 적어주세요."
          />
        </div>
      </details>
    </div>
  );
}
