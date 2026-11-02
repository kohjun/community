"use client";
import Link from "next/link";
import { useId } from "react";
import {
  EXPERIENCE_LABELS,
  COMPANY_LABELS,
  ATMOSPHERE_LABELS,
  INTENSITY_LABELS,
  emptyParticipantGuide,
  onsiteCostLabel,
  type ParticipantGuide,
} from "@/domain/participant-guide";
export function ParticipantGuideEditor({
  value,
  onChange,
}: {
  value: ParticipantGuide | null;
  onChange: (value: ParticipantGuide | null) => void;
}) {
  const prefix = useId(),
    guide = value ?? emptyParticipantGuide();
  const update = (patch: Partial<ParticipantGuide>) => onChange({ ...guide, ...patch });
  return (
    <details className="maturity-panel">
      <summary>
        첫 참가자를 위한 안내 <small>선택 입력 · 신청 화면에 공개</small>
      </summary>
      <p className="form-note">
        미입력 항목은 미안내로 표시해요. 연락처·출입 비밀번호는 적지 말고 승인 후 공지방에서
        알려주세요.
      </p>
      <div className="maturity-fields">
        {(
          [
            { key: "experience", label: "참가 경험", options: EXPERIENCE_LABELS },
            { key: "company", label: "혼자·동반 참여", options: COMPANY_LABELS },
            { key: "atmosphere", label: "진행 분위기", options: ATMOSPHERE_LABELS },
            { key: "intensity", label: "활동 강도", options: INTENSITY_LABELS },
          ] as const
        ).map(({ key, label, options }) => (
          <label key={key} htmlFor={prefix + key}>
            {label}
            <select
              id={prefix + key}
              value={guide[key]}
              onChange={(e) => update({ [key]: e.target.value })}
            >
              {Object.entries(options).map(([v, text]) => (
                <option key={v} value={v}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          예상 현장 비용 최소 (1인·원)
          <input
            type="number"
            min={0}
            max={10000000}
            step={1}
            value={guide.onsiteMinKRW ?? ""}
            onChange={(e) =>
              update({ onsiteMinKRW: e.target.value === "" ? null : Number(e.target.value) })
            }
          />
        </label>
        <label>
          예상 현장 비용 최대 (1인·원)
          <input
            type="number"
            min={0}
            max={10000000}
            step={1}
            value={guide.onsiteMaxKRW ?? ""}
            onChange={(e) =>
              update({ onsiteMaxKRW: e.target.value === "" ? null : Number(e.target.value) })
            }
          />
        </label>
      </div>
      <p className="form-note">
        사전 참가비와 별도인 현장 지출의 예상 범위예요. 현장 비용이 없으면 양쪽에 0을 입력해주세요.
      </p>
      <label>
        비용 안내
        <input
          maxLength={300}
          placeholder="음료는 각자 주문하고 식비는 실제 사용액으로 나눠요."
          value={guide.costNote}
          onChange={(e) => update({ costNote: e.target.value })}
        />
      </label>
      <label>
        처음 도착하면
        <textarea
          rows={3}
          maxLength={600}
          placeholder="입구에서 담당자를 만나 이름표를 받고, 함께 규칙을 설명받아요."
          value={guide.arrival}
          onChange={(e) => update({ arrival: e.target.value })}
        />
      </label>
      <label>
        준비물·참가 전 확인
        <textarea
          rows={3}
          maxLength={600}
          placeholder="편한 신발과 충전된 휴대폰을 준비해주세요."
          value={guide.preparations}
          onChange={(e) => update({ preparations: e.target.value })}
        />
      </label>
      <button type="button" className="participation-secondary" onClick={() => onChange(null)}>
        안내 비우기
      </button>
    </details>
  );
}
export function ParticipantGuideCard({ guide }: { guide?: ParticipantGuide | null }) {
  return (
    <section className="maturity-panel" aria-label="첫 참가 안내">
      <h2>처음 함께해도, 미리 알고 가요</h2>
      {guide ? (
        <>
          <dl className="maturity-facts">
            {[
              { label: "참가 경험", text: EXPERIENCE_LABELS[guide.experience] },
              { label: "함께 오는 방식", text: COMPANY_LABELS[guide.company] },
              { label: "분위기", text: ATMOSPHERE_LABELS[guide.atmosphere] },
              { label: "활동 강도", text: INTENSITY_LABELS[guide.intensity] },
            ].map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.text}</dd>
              </div>
            ))}
          </dl>
          <p>
            <strong>{onsiteCostLabel(guide)}</strong>
          </p>
          <p className="form-note">사전 참가비와 별도인 예상 지출이며 확정 청구액이 아니에요.</p>
          {guide.costNote && <p className="maturity-preserve">{guide.costNote}</p>}
          <h3>처음 도착하면</h3>
          <p className="maturity-preserve">
            {guide.arrival || "담당자가 아직 안내를 등록하지 않았어요."}
          </p>
          <h3>준비물·참가 전 확인</h3>
          <p className="maturity-preserve">
            {guide.preparations || "아직 안내되지 않았어요. 준비물이 없다는 뜻은 아니에요."}
          </p>
        </>
      ) : (
        <p>
          담당자가 아직 첫 참가 안내를 등록하지 않았어요. 모집글에서 참여 조건과 예상 현장 비용을
          확인해주세요.
        </p>
      )}
      <Link href="/help#first-participation">신청부터 첫 만남까지 이용 안내 →</Link>
    </section>
  );
}
