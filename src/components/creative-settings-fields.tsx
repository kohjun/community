"use client";
import { useId } from "react";
import { Check } from "lucide-react";
import { DRAWING_MODES, CLUE_MODES, CLUE_BASIC_LIMITS } from "@/domain/creative-games";
import type { GameRoomSettings } from "@/domain/game-room";
import styles from "./creative-games.module.css";
export const DEFAULT_CREATIVE_OPTIONS = {
  drawingMode: "mix",
  drawingSets: 1,
  drawingSeconds: 45,
  drawingScored: true,
  clueMode: "photo",
  clueRounds: 5,
  clueSeconds: 60,
  clueSource: "basic",
} as const;
export type CreativeOptions = Pick<
  GameRoomSettings,
  keyof typeof DEFAULT_CREATIVE_OPTIONS | "capacity" | "minPlayers"
>;
export function CreativeSettingsFields({
  kind,
  value,
  onChange,
  disabled = false,
}: {
  kind: "drawing" | "clue";
  value: CreativeOptions;
  onChange: (next: Partial<CreativeOptions>) => void;
  disabled?: boolean;
}) {
  const uid = useId();
  const drawing = kind === "drawing",
    modes = drawing ? DRAWING_MODES : CLUE_MODES;
  const clueLimit =
    value.clueSource === "basic" && value.clueMode !== "member"
      ? CLUE_BASIC_LIMITS[value.clueMode]
      : 20;
  return (
    <div className={`${styles.form} ${styles.settingsGroup}`}>
      <fieldset className={styles.modeFieldset} disabled={disabled}>
        <legend>플레이 모드</legend>
        <div className={styles.modes}>
          {Object.entries(modes).map(([id, m]) => (
            <label
              className={styles.mode}
              key={id}
              htmlFor={`${uid}-${id}`}
              data-mode={id}
              data-selected={(drawing ? value.drawingMode : value.clueMode) === id}
              data-disabled={disabled}
            >
              <input
                id={`${uid}-${id}`}
                name={`${uid}-mode`}
                type="radio"
                value={id}
                checked={(drawing ? value.drawingMode : value.clueMode) === id}
                className={styles.hiddenLabel}
                onChange={() => {
                  if (drawing) {
                    const mode = id as keyof typeof DRAWING_MODES;
                    onChange({
                      drawingMode: mode,
                      minPlayers: Math.max(value.minPlayers, DRAWING_MODES[mode].minimum),
                    });
                  } else {
                    const mode = id as keyof typeof CLUE_MODES;
                    onChange({
                      clueMode: mode,
                      clueRounds: Math.min(
                        value.clueRounds,
                        value.clueSource === "basic" && mode !== "member"
                          ? CLUE_BASIC_LIMITS[mode]
                          : 20,
                      ),
                    });
                  }
                }}
              />
              <Check className={styles.modeCheck} size={16} aria-hidden="true" />
              <strong>{m.title}</strong>
              <small>{m.description}</small>
            </label>
          ))}
        </div>
      </fieldset>
      <p className={styles.instruction}>
        {drawing ? DRAWING_MODES[value.drawingMode].rules : CLUE_MODES[value.clueMode].rules}
      </p>
      <div className={styles.fields}>
        <label>
          {drawing ? "진행 바퀴" : "문제 수"}
          {!drawing && value.clueMode === "member" ? (
            <span className={styles.instruction}>참가자마다 한 문제씩</span>
          ) : (
            <select
              name="rounds"
              aria-label={drawing ? "진행 바퀴" : "문제 수"}
              disabled={disabled || (!drawing && value.clueMode === "member")}
              value={drawing ? value.drawingSets : value.clueRounds}
              onChange={(e) =>
                onChange(
                  drawing
                    ? { drawingSets: Number(e.target.value) }
                    : { clueRounds: Number(e.target.value) },
                )
              }
            >
              {(drawing ? [1, 2, 3] : [1, 3, 5, 8, 10, 15, 20].filter((n) => n <= clueLimit)).map(
                (n) => (
                  <option key={n} value={n}>
                    {n}
                    {drawing ? "바퀴" : "문제"}
                  </option>
                ),
              )}
            </select>
          )}
        </label>
        <label>
          {drawing ? "그리기 시간" : "문제 제한시간"}
          <select
            name="answerSeconds"
            aria-label={drawing ? "그리기 시간" : "문제 제한시간"}
            disabled={disabled}
            value={drawing ? value.drawingSeconds : value.clueSeconds}
            onChange={(e) =>
              onChange(
                drawing
                  ? { drawingSeconds: Number(e.target.value) as CreativeOptions["drawingSeconds"] }
                  : { clueSeconds: Number(e.target.value) as CreativeOptions["clueSeconds"] },
              )
            }
          >
            {(drawing ? [30, 45, 60, 90] : [30, 60, 90]).map((n) => (
              <option key={n} value={n}>
                {n}초
              </option>
            ))}
          </select>
        </label>
      </div>
      {drawing && value.drawingMode !== "relay" && (
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={value.drawingScored}
            disabled={disabled}
            onChange={(e) => onChange({ drawingScored: e.target.checked })}
          />
          점수와 우승자 표시
        </label>
      )}
      {!drawing && value.clueMode !== "member" && (
        <label>
          문제 준비
          <select
            value={value.clueSource}
            disabled={disabled}
            onChange={(e) => {
              const source = e.target.value as "basic" | "host";
              onChange({
                clueSource: source,
                clueRounds: Math.min(
                  value.clueRounds,
                  source === "basic" && value.clueMode !== "member"
                    ? CLUE_BASIC_LIMITS[value.clueMode]
                    : 20,
                ),
              });
            }}
          >
            <option value="basic">바로 시작 · Sliper 기본 문제</option>
            <option value="host">호스트가 직접 출제</option>
          </select>
          <small className={styles.muted}>
            {value.clueSource === "host"
              ? "방을 만든 뒤 자료·정답을 등록해요. 출제자는 해당 문제 채점에서 제외돼요."
              : "장소 사진 20개·직접 제작한 합성 소리 10개. 사진은 장소 대표 지점 기준이에요."}
          </small>
        </label>
      )}
      <p className={styles.muted}>
        {drawing
          ? `1바퀴는 모두 각 역할을 한 번씩 맡는 구성 · 정원 기준 ${value.capacity}개 ${value.drawingMode === "live" ? "그림 문제" : "릴레이"}`
          : value.clueMode === "member"
            ? "모두 사진 한 장씩 준비해요. 실제 참가 인원만큼 문제를 진행해요."
            : "모두 제출하거나 시간이 끝나면 공개해요. 제출을 확정한 답은 변경할 수 없어요."}
      </p>
    </div>
  );
}
