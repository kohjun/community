"use client";
import {
  TEMPERATURE_CLUE_SECONDS,
  TEMPERATURE_MODE_INFO,
  TEMPERATURE_MODES,
  TEMPERATURE_SECONDS,
  type TemperatureSettings,
} from "@/domain/temperature-game";
import { GameModePicker } from "./game-mode-picker";

/** Rough upper bound: every step runs to its time limit plus ~20s of talking over the result. */
function playMinutes(value: TemperatureSettings, capacity: number) {
  const seconds =
    value.mode === "basic"
      ? capacity * value.rounds * (TEMPERATURE_CLUE_SECONDS + value.answerSeconds + 20)
      : value.rounds * (value.answerSeconds * 2 + 30);
  return Math.max(1, Math.ceil(seconds / 60));
}

export function TemperatureSettingsFields({
  value,
  capacity,
  disabled,
  rowClassName,
  onChange,
}: {
  value: TemperatureSettings;
  capacity: number;
  disabled: boolean;
  rowClassName: string | undefined;
  onChange: (value: TemperatureSettings) => void;
}) {
  const basic = value.mode === "basic";
  return (
    <>
      <GameModePicker
        legend="어떤 방식으로 놀까요?"
        modes={TEMPERATURE_MODES.map((id) => ({ id, ...TEMPERATURE_MODE_INFO[id] }))}
        value={value.mode}
        note={TEMPERATURE_MODE_INFO[value.mode].rules}
        disabled={disabled}
        onChange={(mode) => onChange({ ...value, mode })}
      />
      <div className={rowClassName}>
        <label>
          몇 라운드 할까요?
          <select
            aria-label="라운드 수"
            value={value.rounds}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, rounds: Number(event.target.value) })}
          >
            {Array.from({ length: 10 }, (_, index) => index + 1).map((rounds) => (
              <option key={rounds} value={rounds}>
                {rounds}라운드{rounds === 2 ? " (추천)" : ""}
              </option>
            ))}
          </select>
          <small>
            {basic ? "1라운드 = 모두 한 번씩 설명해요" : "1라운드 = 상황 쓰기 + 줄 세우기"}
          </small>
        </label>
        <label>
          {basic ? "숫자 고르는 시간" : "단계별 제한시간"}
          <select
            aria-label={basic ? "숫자 고르는 시간" : "단계별 제한시간"}
            value={value.answerSeconds}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...value,
                answerSeconds: Number(event.target.value) as TemperatureSettings["answerSeconds"],
              })
            }
          >
            {TEMPERATURE_SECONDS.map((seconds) => (
              <option key={seconds} value={seconds}>
                {seconds}초{seconds === 60 ? " (추천)" : ""}
              </option>
            ))}
          </select>
          <small>
            {basic
              ? `설명 시간은 ${TEMPERATURE_CLUE_SECONDS}초로 정해져 있어요`
              : "쓰기·줄 세우기 각각"}
          </small>
        </label>
      </div>
      <small>
        ⏱️ {capacity}명이 모두 참여하면 길어야 약 {playMinutes(value, capacity)}분이에요. 모두 빨리
        제출하면 더 일찍 끝나요.
      </small>
    </>
  );
}
