"use client";
import {
  TOAST_MODE_INFO,
  TOAST_MODES,
  TOAST_SECONDS,
  type ToastSettings,
} from "@/domain/toast-game";
import { GameModePicker } from "./game-mode-picker";

/** 건배의 눈치 options, shared by room creation and the lobby settings panel. */
export function ToastSettingsFields({
  value,
  capacity,
  disabled,
  rowClassName,
  roundsLabel,
  secondsLabel,
  onChange,
}: {
  value: ToastSettings;
  capacity: number;
  disabled: boolean;
  rowClassName: string | undefined;
  /** Accessible names stay distinct between the create form and the lobby panel. */
  roundsLabel: string;
  secondsLabel: string;
  onChange: (value: Partial<ToastSettings>) => void;
}) {
  // Roughly: writing a question (~30s) + choosing + ~15s to look at the count, per question.
  const minutes = Math.max(
    1,
    Math.ceil((capacity * value.rounds * (30 + value.answerSeconds + 15)) / 60),
  );
  return (
    <>
      <GameModePicker
        legend="어떤 방식으로 놀까요?"
        modes={TOAST_MODES.map((id) => ({ id, ...TOAST_MODE_INFO[id] }))}
        value={value.mode}
        note={TOAST_MODE_INFO[value.mode].rules}
        disabled={disabled}
        onChange={(mode) => onChange({ mode })}
      />
      <div className={rowClassName}>
        <label>
          몇 라운드 할까요?
          <select
            aria-label={roundsLabel}
            disabled={disabled}
            value={value.rounds}
            onChange={(e) => onChange({ rounds: Number(e.target.value) })}
          >
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}라운드{n === 2 ? " (추천)" : ""}
              </option>
            ))}
          </select>
          <small>1라운드 = 모두 한 번씩 질문해요</small>
        </label>
        <label>
          건배·패스 고르는 시간
          <select
            aria-label={secondsLabel}
            disabled={disabled}
            value={value.answerSeconds}
            onChange={(e) => onChange({ answerSeconds: Number(e.target.value) })}
          >
            {TOAST_SECONDS.map((n) => (
              <option key={n} value={n}>
                {n}초{n === 30 ? " (추천)" : ""}
              </option>
            ))}
          </select>
          <small>시간 안에 못 고르면 패스로 처리돼요</small>
        </label>
      </div>
      <small>
        ⏱️ {capacity}명이 모두 참여하면 질문 {capacity * value.rounds}개, 길어야 약 {minutes}
        분이에요. 누가 건배했는지는 끝까지 공개하지 않아요.
      </small>
    </>
  );
}
