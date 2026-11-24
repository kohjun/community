"use client";
import {
  DRAWING_MODES,
  DRAWING_MODE_ORDER,
  CLUE_MODES,
  CLUE_BASIC_LIMITS,
  CLUE_MODE_ORDER,
  drawingPlayMinutes,
} from "@/domain/creative-games";
import type { GameRoomSettings } from "@/domain/game-room";
import { GameModePicker } from "./game-mode-picker";
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
  const drawing = kind === "drawing";
  const clueLimit =
    value.clueSource === "basic" && value.clueMode !== "member"
      ? CLUE_BASIC_LIMITS[value.clueMode]
      : 20;
  if (drawing) {
    const mode = DRAWING_MODES[value.drawingMode];
    return (
      <div className={`${styles.form} ${styles.settingsGroup}`}>
        <GameModePicker
          legend="어떤 방식으로 놀까요?"
          modes={DRAWING_MODE_ORDER.map((id) => ({ id, ...DRAWING_MODES[id] }))}
          value={value.drawingMode}
          note={mode.scoring}
          disabled={disabled}
          onChange={(id) =>
            onChange({
              drawingMode: id,
              minPlayers: Math.max(value.minPlayers, DRAWING_MODES[id].minimum),
            })
          }
        />
        <div className={styles.fields}>
          <label>
            몇 바퀴 할까요?
            <select
              name="rounds"
              aria-label="진행 바퀴"
              disabled={disabled}
              value={value.drawingSets}
              onChange={(e) => onChange({ drawingSets: Number(e.target.value) })}
            >
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}바퀴
                </option>
              ))}
            </select>
            <small className={styles.muted}>1바퀴 = 모두가 한 번씩 그려요</small>
          </label>
          <label>
            그리는 시간
            <select
              name="answerSeconds"
              aria-label="그리기 시간"
              disabled={disabled}
              value={value.drawingSeconds}
              onChange={(e) =>
                onChange({
                  drawingSeconds: Number(e.target.value) as CreativeOptions["drawingSeconds"],
                })
              }
            >
              {[30, 45, 60, 90].map((n) => (
                <option key={n} value={n}>
                  {n}초{n === 45 ? " (추천)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        {value.drawingMode !== "relay" && (
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={value.drawingScored}
              disabled={disabled}
              onChange={(e) => onChange({ drawingScored: e.target.checked })}
            />
            점수를 매기고 우승자를 정해요
          </label>
        )}
        <p className={styles.drawEstimate}>
          ⏱️ {value.capacity}명이 모두 참여하면 길어야 약{" "}
          <strong>
            {drawingPlayMinutes(
              value.drawingMode,
              value.capacity,
              value.drawingSeconds,
              value.drawingSets,
            )}
            분
          </strong>
          이에요. 모두 빨리 제출하면 더 일찍 끝나요.
        </p>
      </div>
    );
  }
  const mode = CLUE_MODES[value.clueMode];
  const member = value.clueMode === "member";
  const questions = member ? value.capacity : value.clueRounds;
  const clueMinutes = Math.max(1, Math.ceil((questions * (value.clueSeconds + 15)) / 60));
  const changeClueMode = (id: (typeof CLUE_MODE_ORDER)[number]) =>
    onChange({
      clueMode: id,
      clueRounds: Math.min(
        value.clueRounds,
        value.clueSource === "basic" && id !== "member" ? CLUE_BASIC_LIMITS[id] : 20,
      ),
    });
  return (
    <div className={`${styles.form} ${styles.settingsGroup}`}>
      <GameModePicker
        legend="어떤 방식으로 맞혀볼까요?"
        modes={CLUE_MODE_ORDER.map((id) => ({ id, ...CLUE_MODES[id] }))}
        value={value.clueMode}
        note={mode.rules}
        disabled={disabled}
        onChange={changeClueMode}
      />
      {!member && (
        <label>
          문제는 누가 낼까요?
          <select
            name="clueSource"
            aria-label="문제 준비 방법"
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
            <option value="basic">바로 시작 · 실제 거리뷰 문제 (추천)</option>
            <option value="host">호스트가 직접 출제</option>
          </select>
          <small className={styles.muted}>
            {value.clueSource === "host"
              ? value.clueMode === "quiz"
                ? "방을 만든 뒤 소리·영상과 보기 4개를 등록해요. 출제자는 그 문제에서 쉬어요."
                : "방을 만든 뒤 사진과 정답 위치를 등록해요. 출제자는 그 문제에서 쉬어요."
              : "전국 명소의 실제 네이버 거리뷰 중에서 무작위로 나와요."}
          </small>
        </label>
      )}
      <div className={styles.fields}>
        <label>
          문제 수
          {member ? (
            <>
              <span className={styles.instruction}>한 사람당 한 문제</span>
              <small className={styles.muted}>사진을 낸 사람 수만큼 진행해요</small>
            </>
          ) : (
            <select
              name="rounds"
              aria-label="문제 수"
              disabled={disabled}
              value={value.clueRounds}
              onChange={(e) => onChange({ clueRounds: Number(e.target.value) })}
            >
              {[1, 3, 5, 8, 10, 15, 20]
                .filter((n) => n <= clueLimit)
                .map((n) => (
                  <option key={n} value={n}>
                    {n}문제{n === 5 ? " (추천)" : ""}
                  </option>
                ))}
            </select>
          )}
        </label>
        <label>
          한 문제 제한시간
          <select
            name="answerSeconds"
            aria-label="문제 제한시간"
            disabled={disabled}
            value={value.clueSeconds}
            onChange={(e) =>
              onChange({ clueSeconds: Number(e.target.value) as CreativeOptions["clueSeconds"] })
            }
          >
            {[30, 60, 90].map((n) => (
              <option key={n} value={n}>
                {n}초{n === 60 ? " (추천)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className={styles.drawEstimate}>
        ⏱️ {member ? `${value.capacity}명이 모두 사진을 내면 ` : ""}길어야 약{" "}
        <strong>{clueMinutes}분</strong>이에요. 모두 빨리 제출하면 더 일찍 끝나요.
      </p>
    </div>
  );
}
