"use client";
import { useEffect, useState } from "react";
import { Clock3, Pause, Play, SkipForward } from "lucide-react";
import type { GameRoomView } from "@/domain/game-room";
import type { CreativePlayer } from "@/domain/creative-games";
import styles from "./creative-games.module.css";
export type CreativeAction = (
  action: Record<string, unknown>,
  asHost?: boolean,
) => Promise<boolean>;
export function CreativeClock({
  endsAt,
  serverNow,
  paused,
  onExpired,
}: {
  endsAt: number | null;
  serverNow: number;
  paused: boolean;
  onExpired: () => void;
}) {
  const [now, setNow] = useState(Date.now()),
    offset = serverNow - Date.now();
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const [delta, setDelta] = useState(offset);
  useEffect(() => setDelta(serverNow - Date.now()), [serverNow]);
  const seconds = endsAt === null ? null : Math.max(0, Math.ceil((endsAt - now - delta) / 1000));
  useEffect(() => {
    if (seconds !== 0 || paused) return;
    const timer = setTimeout(onExpired, 200 + Math.random() * 700);
    const retry = setInterval(onExpired, 2000);
    return () => {
      clearTimeout(timer);
      clearInterval(retry);
    };
  }, [seconds, paused, onExpired]);
  return (
    <span className={styles.clock} data-urgent={seconds !== null && seconds <= 10}>
      <Clock3 size={15} />
      {paused ? "잠시 쉬는 중" : seconds === null ? "결과 감상" : `${seconds}초`}
    </span>
  );
}
export function CreativeControls({
  room,
  phaseId,
  paused,
  busy,
  onAction,
}: {
  room: GameRoomView;
  phaseId: string;
  paused: boolean;
  busy: boolean;
  onAction: CreativeAction;
}) {
  if (!room.isHost || room.phase !== "playing") return null;
  return (
    <div className={styles.controls} aria-label="진행자 제어">
      <button
        className={styles.secondary}
        disabled={busy}
        onClick={() =>
          void onAction(
            {
              action: "creative-control",
              command: paused ? "resume" : "pause",
              phaseId,
              revision: room.revision,
            },
            true,
          )
        }
      >
        {paused ? <Play size={14} /> : <Pause size={14} />} {paused ? "계속 진행" : "잠깐 쉬기"}
      </button>
      <button
        className={styles.secondary}
        disabled={busy || paused}
        onClick={() =>
          void onAction(
            { action: "creative-control", command: "next", phaseId, revision: room.revision },
            true,
          )
        }
      >
        <SkipForward size={14} /> 다음 단계
      </button>
    </div>
  );
}
export function CreativeScores({
  players,
  self,
}: {
  players: CreativePlayer[];
  self: string | null;
}) {
  return (
    <div className={styles.scoreboard} aria-label="누적 점수">
      {[...players]
        .sort((a, b) => b.score - a.score)
        .map((p) => (
          <span className={styles.score} key={p.id} data-self={self === p.id}>
            {p.nickname}
            {self === p.id ? " · 나" : ""}
            <b>{p.score}점</b>
          </span>
        ))}
    </div>
  );
}
export function CreativeWinners({ players }: { players: CreativePlayer[] }) {
  const best = Math.max(...players.map((p) => p.score));
  const winners = players.filter((p) => p.score === best);
  return (
    <div className={styles.finish}>
      <span className={styles.eyebrow}>THAT WAS A GOOD GAME</span>
      <h3>
        {winners.length === players.length && best === 0
          ? "함께 즐겨서 더 재미있었어요"
          : `${winners.map((p) => p.nickname).join(" · ")} ${winners.length > 1 ? "공동 우승!" : "우승!"}`}
      </h3>
      <p className={styles.muted}>
        탈락 없이 함께한 한 판. 결과와 개인 자료는 종료 후 24시간 동안 볼 수 있어요.
      </p>
    </div>
  );
}

export function CreativeSubmissionStatus({
  submitted,
  expected,
}: {
  submitted: number;
  expected: number;
}) {
  if (expected < 1) return null;
  const count = Math.max(0, Math.min(expected, submitted));
  return (
    <div className={styles.submissionStatus}>
      <div>
        <span>{count === expected ? "모두 제출했어요" : "함께 답을 준비하고 있어요"}</span>
        <strong>
          {count}
          <small> / {expected}명</small>
        </strong>
      </div>
      <progress aria-label="답안 제출 현황" value={count} max={expected} />
    </div>
  );
}
