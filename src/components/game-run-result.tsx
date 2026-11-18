"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { GameRoomView } from "@/domain/game-room";
import { appRequest } from "@/lib/api-client";
import { DrawingGameStage } from "./drawing-game-stage";
import { ClueGameStage } from "./clue-game-stage";
import styles from "./creative-games.module.css";
export function GameRunResult({ roomId, runId }: { roomId: string; runId: string }) {
  const [room, setRoom] = useState<GameRoomView | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const host = new URLSearchParams(location.search).get("host") === "1";
    void appRequest<GameRoomView>(
      `/api/games/${roomId}/results/${runId}${host ? "?host=1" : ""}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then(setRoom)
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "게임 결과를 불러오지 못했어요.");
      });
    return () => controller.abort();
  }, [roomId, runId]);
  return (
    <div className={styles.stage}>
      <div className={styles.heading}>
        <h2>{room?.title ?? "우리의 게임 기록"}</h2>
        <Link href="/games" className={styles.secondary}>
          다른 게임 둘러보기
        </Link>
      </div>
      <p className={styles.muted}>
        함께한 참가자만 같은 브라우저의 참가 연결로 볼 수 있어요. 종료 24시간 후 자동 정리돼요.
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {room?.drawing && (
        <DrawingGameStage
          room={room}
          busy={false}
          onAction={async () => false}
          onRefresh={() => {}}
        />
      )}
      {room?.clue && (
        <ClueGameStage room={room} busy={false} onAction={async () => false} onRefresh={() => {}} />
      )}
      {!room && !error && <p className={styles.status}>게임 결과를 불러오고 있어요…</p>}
    </div>
  );
}
