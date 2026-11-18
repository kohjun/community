import "server-only";
import { drawingFinalizer } from "./game-drawing-finalize";
import { syncDrawingAuthority } from "./game-ink-runtime";
import { cookies } from "next/headers";
import { getDatabase } from "../db/client";
import { gameRoomId } from "../domain/game-room";
import { currentActor } from "./identity";
import { AppError, requireActor } from "./errors";
import {
  GAME_COOKIE,
  issueGameSession,
  verifyGameSession,
  gameDigest,
  gameNetworkKey,
} from "./game-session";
import { gameRoomService } from "./game-room-service";
import { publishRoomWake } from "./room-realtime";
export function gameService() {
  return gameRoomService(getDatabase(), {
    wake: publishRoomWake,
    drawingAuthority: syncDrawingAuthority,
    finalizeDrawing: drawingFinalizer(),
  });
}
export async function gameContext(
  request: Request,
  id: string,
  host: boolean,
  createCookie = false,
) {
  const roomId = gameRoomId.parse(id),
    secret = process.env.VISITOR_HASH_SECRET ?? "";
  if (secret.length < 32) throw new Error("Game sessions are not configured.");
  const networkHash = gameNetworkKey(request.headers, secret, roomId);
  if (host) {
    const actor = await gameHost();
    return { identityHash: gameDigest(secret, `host-player:${roomId}`, actor), networkHash, actor };
  }
  const jar = await cookies();
  let device = verifyGameSession(jar.get(GAME_COOKIE)?.value, secret);
  if (!device && createCookie) {
    const token = issueGameSession(secret);
    jar.set(GAME_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.APP_ORIGIN?.startsWith("https:") ?? false,
      path: "/",
      maxAge: 86400,
    });
    device = verifyGameSession(token, secret);
  }
  if (!device) throw new AppError("UNAUTHENTICATED", "다시 입장해 기기 연결을 확인해주세요.");
  if (
    device &&
    Date.now() - Number(jar.get(GAME_COOKIE)?.value.split(".")[1] ?? Date.now()) > 300000
  ) {
    jar.set(GAME_COOKIE, issueGameSession(secret, Date.now(), device), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.APP_ORIGIN?.startsWith("https:") ?? false,
      path: "/",
      maxAge: 86400,
    });
  }
  return {
    identityHash: gameDigest(secret, `player:${roomId}`, device),
    networkHash,
    actor: null,
  };
}
export async function gameHost() {
  return requireActor(await currentActor());
}
