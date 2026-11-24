"use client";
import { SnapPangSettingsFields } from "./snap-pang-settings-fields";
import { SNAP_PANG_PRESET_META, snapPangSettingsFrom } from "@/domain/snap-pang";
import { CreativeSettingsFields } from "./creative-settings-fields";
import { DRAWING_MODES, CLUE_MODES } from "@/domain/creative-games";
import { TemperatureSettingsFields } from "./temperature-settings-fields";
import { ToastSettingsFields } from "./toast-settings-fields";
import { AuctionSettingsFields } from "./auction-settings-fields";
import { TEMPERATURE_MODE_LABELS, temperatureSettingsFrom } from "@/domain/temperature-game";
import { TOAST_MODE_INFO } from "@/domain/toast-game";
import { useState } from "react";
import { Check, ChevronDown, RefreshCw, Settings2, X } from "lucide-react";
import type { GameRoomSettings, GameRoomView } from "@/domain/game-room";
import {
  WORD_CATEGORIES,
  WORD_MODE_LABELS,
  type WordCategory,
  type WordMode,
} from "@/domain/word-liar";
import styles from "./game-room-settings.module.css";
export function GameRoomSettingsPanel({
  room,
  busy,
  onSave,
}: {
  room: GameRoomView;
  busy: boolean;
  onSave: (settings: GameRoomSettings, version: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<GameRoomSettings | null>(null),
    [version, setVersion] = useState(""),
    [saved, setSaved] = useState(false);
  const config = room.settings;
  if (!config || !room.settingsVersion || room.phase !== "lobby") return null;
  const activeConfig = draft ?? config;
  const minimum =
    config.gameType === "drawing"
      ? DRAWING_MODES[activeConfig.drawingMode].minimum
      : config.gameType === "clue" || config.gameType === "lobby" || config.gameType === "snap-pang"
        ? 2
        : 3;
  const maximum =
    config.gameType === "drawing" || config.gameType === "clue" || config.gameType === "snap-pang"
      ? 12
      : 30;
  const stale = open && version !== room.settingsVersion;
  const patch = (next: Partial<GameRoomSettings>) =>
    setDraft((value) => (value ? { ...value, ...next } : value));
  const load = () => {
    setDraft({ ...config });
    setVersion(room.settingsVersion!);
    setSaved(false);
  };
  const info = [
    `정원 ${config.capacity}명`,
    `최소 ${config.minPlayers}명`,
    ...(config.gameType === "snap-pang"
      ? [
          SNAP_PANG_PRESET_META[config.snapPreset].title,
          `${config.snapRounds}라운드`,
          `${config.snapSeconds}초`,
        ]
      : []),
    ...(config.gameType === "drawing"
      ? [
          DRAWING_MODES[config.drawingMode].title,
          `${config.drawingSets}바퀴`,
          `${config.drawingSeconds}초`,
        ]
      : []),
    ...(config.gameType === "clue"
      ? [
          CLUE_MODES[config.clueMode].title,
          config.clueMode === "member" ? "모두 사진 1장씩" : `${config.clueRounds}문제`,
          `${config.clueSeconds}초`,
        ]
      : []),
    ...(config.gameType === "temperature"
      ? [
          TEMPERATURE_MODE_LABELS[config.temperatureMode],
          `${config.temperatureRounds}라운드`,
          `제출 ${config.temperatureAnswerSeconds}초`,
        ]
      : []),
    ...(config.gameType === "toast"
      ? [
          TOAST_MODE_INFO[config.toastMode].title,
          `${config.toastRounds}라운드`,
          `선택 ${config.toastAnswerSeconds}초`,
        ]
      : []),
    ...(config.gameType === "auction"
      ? [
          `${config.auctionRounds}라운드`,
          `${config.auctionInitialMoney.toLocaleString()}G`,
          `입찰 ${config.auctionBidSeconds}초`,
        ]
      : []),
    ...(config.gameType === "mbti-intro" ? [`${config.maxRounds}라운드`] : []),
    ...(config.gameType === "word-liar"
      ? [
          WORD_CATEGORIES.find((c) => c.id === config.wordCategory)!.label,
          WORD_MODE_LABELS[config.wordMode],
        ]
      : []),
    ...(config.gameType === "mbti"
      ? [config.revealLiar ? "라이어 정체 공개" : "라이어 정체 비공개"]
      : []),
  ];
  return (
    <section className={styles.panel} aria-label="게임방 설정">
      <div className={styles.heading}>
        <div>
          <span className={styles.icon}>
            <Settings2 size={17} />
          </span>
          <h2>게임방 설정</h2>
        </div>
        {room.isHost && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls="room-settings-form"
            disabled={busy}
            onClick={() => {
              if (!open) load();
              setOpen((v) => !v);
            }}
          >
            {open ? "닫기" : "설정 변경"}
            {open ? <X size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>
      <div className={styles.summary}>
        {info.map((text) => (
          <span key={text}>{text}</span>
        ))}
      </div>
      {saved && (
        <p className={styles.saved} role="status">
          <Check size={14} /> 설정을 저장했어요. 참가자의 준비 상태는 유지돼요.
        </p>
      )}
      {open && room.isHost && draft && (
        <form
          id="room-settings-form"
          className={styles.form}
          onSubmit={async (event) => {
            event.preventDefault();
            if (!busy && !stale) {
              const success = await onSave(draft, version);
              if (success) {
                setOpen(false);
                setSaved(true);
              }
            }
          }}
        >
          <p className={styles.help}>
            대기실에서 옵션을 바꿀 수 있어요. 저장해도 참가자의 준비·닉네임은 그대로 유지돼요.
          </p>
          {stale && (
            <div className={styles.conflict} role="alert">
              <p>다른 창에서 설정을 변경했어요. 최신 설정을 확인한 뒤 다시 수정해주세요.</p>
              <button type="button" onClick={load}>
                <RefreshCw size={14} /> 최신 설정 불러오기
              </button>
            </div>
          )}
          <label>
            방 이름
            <input
              aria-label="게임방 설정 방 이름"
              value={draft.title}
              onChange={(e) => patch({ title: e.target.value })}
              minLength={2}
              maxLength={60}
              required
              disabled={busy}
            />
          </label>
          <div className={styles.grid}>
            <label>
              참가 정원
              <select
                aria-label="게임방 설정 참가 정원"
                disabled={busy}
                value={draft.capacity}
                onChange={(e) => {
                  const capacity = Number(e.target.value),
                    minPlayers = Math.min(draft.minPlayers, capacity);
                  patch({
                    capacity,
                    minPlayers,
                    auctionRounds: Math.max(
                      draft.auctionRounds,
                      minPlayers + 1,
                      room.players.length + 1,
                    ),
                  });
                }}
              >
                {Array.from(
                  { length: maximum + 1 - Math.max(minimum, room.players.length) },
                  (_, i) => i + Math.max(minimum, room.players.length),
                ).map((n) => (
                  <option key={n} value={n}>
                    {n}명
                  </option>
                ))}
              </select>
            </label>
            <label>
              시작 최소 인원
              <select
                aria-label="게임방 설정 시작 최소 인원"
                disabled={busy}
                value={draft.minPlayers}
                onChange={(e) => {
                  const minPlayers = Number(e.target.value);
                  patch({
                    minPlayers,
                    auctionRounds: Math.max(draft.auctionRounds, minPlayers + 1),
                  });
                }}
              >
                {Array.from({ length: draft.capacity - minimum + 1 }, (_, i) => i + minimum).map(
                  (n) => (
                    <option key={n} value={n}>
                      {n}명부터
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
          {config.gameType === "snap-pang" && (
            <SnapPangSettingsFields
              value={snapPangSettingsFrom(draft)}
              disabled={busy}
              onChange={(value) =>
                patch({
                  ...(value.preset !== undefined ? { snapPreset: value.preset } : {}),
                  ...(value.rounds !== undefined ? { snapRounds: value.rounds } : {}),
                  ...(value.seconds !== undefined ? { snapSeconds: value.seconds } : {}),
                })
              }
            />
          )}
          {(config.gameType === "drawing" || config.gameType === "clue") && (
            <CreativeSettingsFields
              kind={config.gameType}
              value={draft}
              onChange={patch}
              disabled={busy}
            />
          )}
          {config.gameType === "temperature" && (
            <TemperatureSettingsFields
              value={temperatureSettingsFrom(draft)}
              capacity={draft.capacity}
              disabled={busy}
              rowClassName={styles.grid}
              onChange={(value) =>
                patch({
                  temperatureMode: value.mode,
                  temperatureRounds: value.rounds,
                  temperatureAnswerSeconds: value.answerSeconds,
                })
              }
            />
          )}
          {config.gameType === "toast" && (
            <ToastSettingsFields
              value={{
                mode: draft.toastMode,
                rounds: draft.toastRounds,
                answerSeconds: draft.toastAnswerSeconds,
              }}
              capacity={draft.capacity}
              disabled={busy}
              rowClassName={styles.grid}
              roundsLabel="게임방 설정 건배 라운드"
              secondsLabel="게임방 설정 건배 제한시간"
              onChange={(next) =>
                patch({
                  ...(next.mode ? { toastMode: next.mode } : {}),
                  ...(next.rounds !== undefined ? { toastRounds: next.rounds } : {}),
                  ...(next.answerSeconds !== undefined
                    ? {
                        toastAnswerSeconds:
                          next.answerSeconds as GameRoomSettings["toastAnswerSeconds"],
                      }
                    : {}),
                })
              }
            />
          )}
          {config.gameType === "auction" && (
            <AuctionSettingsFields
              value={{
                rounds: draft.auctionRounds,
                initialMoney: draft.auctionInitialMoney,
                bidSeconds: draft.auctionBidSeconds,
              }}
              capacity={draft.capacity}
              minRounds={Math.max(4, draft.minPlayers + 1, room.players.length + 1)}
              disabled={busy}
              rowClassName={styles.grid}
              labels={{
                rounds: "게임방 설정 경매 라운드",
                money: "게임방 설정 시작 머니",
                seconds: "게임방 설정 입찰 시간",
              }}
              onChange={(next) =>
                patch({
                  ...(next.rounds !== undefined ? { auctionRounds: next.rounds } : {}),
                  ...(next.initialMoney !== undefined
                    ? { auctionInitialMoney: next.initialMoney }
                    : {}),
                  ...(next.bidSeconds !== undefined
                    ? {
                        auctionBidSeconds: next.bidSeconds as GameRoomSettings["auctionBidSeconds"],
                      }
                    : {}),
                })
              }
            />
          )}
          {config.gameType === "word-liar" && (
            <div className={styles.grid}>
              <label>
                제시어 카테고리
                <select
                  aria-label="게임방 설정 제시어 카테고리"
                  disabled={busy}
                  value={draft.wordCategory}
                  onChange={(e) => patch({ wordCategory: e.target.value as WordCategory })}
                >
                  {WORD_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                라이어 방식
                <select
                  aria-label="게임방 설정 라이어 방식"
                  disabled={busy}
                  value={draft.wordMode}
                  onChange={(e) => patch({ wordMode: e.target.value as WordMode })}
                >
                  {Object.entries(WORD_MODE_LABELS).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {config.gameType === "mbti-intro" && (
            <label>
              진행 라운드 수
              <select
                aria-label="게임방 설정 자기소개 라운드"
                disabled={busy}
                value={draft.maxRounds}
                onChange={(e) => patch({ maxRounds: Number(e.target.value) })}
              >
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}라운드
                  </option>
                ))}
              </select>
            </label>
          )}
          {config.gameType === "mbti" && (
            <label>
              라이어에게 정체 알림
              <select
                aria-label="게임방 설정 MBTI 정체 알림"
                disabled={busy}
                value={String(draft.revealLiar)}
                onChange={(e) => patch({ revealLiar: e.target.value === "true" })}
              >
                <option value="false">제시어만 보여주기</option>
                <option value="true">라이어라고 알려주기</option>
              </select>
            </label>
          )}
          {draft.capacity < room.players.length && (
            <p className={styles.conflict} role="alert">
              입장한 인원이 늘었어요. 정원을 {room.players.length}명 이상으로 맞춰주세요.
            </p>
          )}
          <div className={styles.actions}>
            <button type="button" disabled={busy} onClick={() => setOpen(false)}>
              취소
            </button>
            <button type="submit" disabled={busy || stale || draft.capacity < room.players.length}>
              {busy ? "저장 중…" : "설정 저장"}
              <Check size={15} />
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
