"use client";

import { useId } from "react";
import { Check } from "lucide-react";
import {
  SNAP_PANG_PRESETS,
  SNAP_PANG_PRESET_META,
  SNAP_PANG_ROUND_COUNTS,
  SNAP_PANG_SECONDS,
  snapPangRoundPlan,
  snapPangSlotLabel,
  type SnapPangSettings,
} from "@/domain/snap-pang";
import styles from "./snap-pang-settings-fields.module.css";

export function SnapPangSettingsFields({
  value,
  disabled = false,
  onChange,
}: {
  value: SnapPangSettings;
  disabled?: boolean;
  onChange: (next: Partial<SnapPangSettings>) => void;
}) {
  const uid = useId();
  const activeMeta = SNAP_PANG_PRESET_META[value.preset];
  // Random mode draws its order when the game starts, so the preview cannot name rounds yet.
  const plan =
    value.preset === "random"
      ? Array.from({ length: value.rounds }, () => "🎲 랜덤")
      : snapPangRoundPlan(value.preset, value.rounds).map(snapPangSlotLabel);

  return (
    <div className={styles.group}>
      <fieldset className={styles.fieldset} disabled={disabled}>
        <legend>플레이 모드</legend>
        <div className={styles.cards}>
          {SNAP_PANG_PRESETS.map((preset) => {
            const meta = SNAP_PANG_PRESET_META[preset];
            const selected = value.preset === preset;
            const inputId = `${uid}-${preset}`;
            return (
              <label
                key={preset}
                htmlFor={inputId}
                className={styles.card}
                data-selected={selected}
                data-disabled={disabled}
              >
                <input
                  id={inputId}
                  name={`${uid}-snap-preset`}
                  type="radio"
                  value={preset}
                  checked={selected}
                  disabled={disabled}
                  className={styles.srOnly}
                  onChange={() => onChange({ preset })}
                />
                <div className={styles.cardTop}>
                  <span className={styles.titleRow}>
                    <span className={styles.checkCircle} aria-hidden="true">
                      {selected && <Check size={12} strokeWidth={3} />}
                    </span>
                    {meta.title}
                  </span>
                  <span className={styles.badge}>{meta.badge}</span>
                </div>
                <p className={styles.desc}>{meta.subtitle}</p>
                <div className={styles.tags}>
                  {meta.games.map((tag) => (
                    <span key={tag} className={styles.tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className={styles.selectGrid}>
        <label>
          총 라운드 수
          <select
            aria-label="스냅 팡 라운드 수"
            value={value.rounds}
            disabled={disabled}
            onChange={(e) =>
              onChange({ rounds: Number(e.target.value) as SnapPangSettings["rounds"] })
            }
          >
            {SNAP_PANG_ROUND_COUNTS.map((n) => (
              <option key={n} value={n}>
                {n}라운드
              </option>
            ))}
          </select>
        </label>
        <label>
          라운드 제한시간
          <select
            aria-label="스냅 팡 제한시간"
            value={value.seconds}
            disabled={disabled}
            onChange={(e) =>
              onChange({ seconds: Number(e.target.value) as SnapPangSettings["seconds"] })
            }
          >
            {SNAP_PANG_SECONDS.map((sec) => (
              <option key={sec} value={sec}>
                {sec}초
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.preview} aria-live="polite">
        <div className={styles.previewHead}>
          <span>진행 순서 미리보기 ({value.rounds}라운드)</span>
          <span className={styles.previewCamera}>{activeMeta.cameraNote}</span>
        </div>
        <div className={styles.planFlow}>
          {plan.map((label, idx) => (
            <span key={`${idx}-${label}`} className={styles.planPill}>
              <b>{idx + 1}R</b> {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
