import "server-only";
import { createInkRedis } from "./game-ink-redis";
import type { InkAuthority } from "./game-ink-core";
import { AppError } from "./errors";
let pending: ReturnType<typeof createInkRedis> | null = null;
export async function gameInkRedis() {
  const url = process.env.GAME_REDIS_URL ?? process.env.TOWN_REDIS_URL ?? process.env.REDIS_URL;
  if (!url) throw new AppError("INTERNAL", "그림 실시간 서버 연결을 준비하고 있어요.");
  if (!pending)
    pending = createInkRedis(url).catch((e) => {
      pending = null;
      throw e;
    });
  return pending;
}
export async function syncDrawingAuthority(a: InkAuthority) {
  try {
    await (await gameInkRedis()).sync(a);
  } catch {
    /* Room state remains durable; ink endpoint shows an explicit reconnect error. */
  }
}
