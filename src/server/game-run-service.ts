import { and, eq, gt } from "drizzle-orm";
import type { Database } from "../db/connection";
import { gameRuns } from "../db/game-room-schema";
import { memberSafety } from "../db/safety-schema";
import { membershipActive } from "../domain/safety";
import { drawingView } from "./drawing-game";
import { clueView } from "./clue-game";
import type { GamePrincipal } from "./game-room-service";
import type { GameRoomView } from "../domain/game-room";
import { AppError } from "./errors";
export async function readGameRun(
  db: Database,
  roomId: string,
  runId: string,
  who: GamePrincipal,
  now = new Date(),
): Promise<GameRoomView> {
  const [run] = await db
    .select()
    .from(gameRuns)
    .where(and(eq(gameRuns.id, runId), eq(gameRuns.roomId, roomId), gt(gameRuns.expiresAt, now)));
  if (!run) throw new AppError("NOT_FOUND", "결과 보관 기간이 지났거나 볼 수 없는 게임이에요.");
  const playerId =
      Object.entries(run.members).find(([, hash]) => hash === who.identityHash)?.[0] ?? null,
    host = who.actor !== null && who.actor === run.hostId;
  if (!host && !playerId)
    throw new AppError("NOT_FOUND", "이 게임에 함께한 참가자만 결과를 볼 수 있어요.");
  if (host) {
    const [state] = await db.select().from(memberSafety).where(eq(memberSafety.userId, who.actor!));
    if (!membershipActive(state, now)) throw new AppError("FORBIDDEN", "계정 상태를 확인해주세요.");
  }
  const { drawing, clue } = run.content,
    roster = drawing?.roster ?? clue?.roster ?? [];
  return {
    id: roomId,
    title: run.title,
    capacity: roster.length,
    minPlayers: 2,
    phase: "finished",
    revision: 0,
    round: 1,
    startedAt: run.startedAt.toISOString(),
    expiresAt: run.expiresAt.toISOString(),
    isHost: host,
    canStart: false,
    waitingCount: 0,
    readyCount: 0,
    viewer: {
      id: playerId,
      status: playerId ? "admitted" : "host",
      nickname: roster.find((p) => p.id === playerId)?.nickname ?? null,
      ready: false,
      queuePosition: null,
    },
    players: roster.map((p) => ({ id: p.id, nickname: p.nickname, ready: false, online: false })),
    waiting: [],
    gameType: drawing ? "drawing" : "clue",
    drawing: drawing ? drawingView(drawing, playerId, now.getTime()) : null,
    clue: clue ? clueView(clue, playerId, now.getTime()) : null,
  };
}
