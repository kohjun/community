import { appRequest } from "./api-client";
import type { GameRoomView } from "../domain/game-room";
const connecting = new Map<string, Promise<GameRoomView>>();
/** Reuse Strict Mode's in-flight join so first visits cannot allocate two cookies/seats. */
export function connectGameRoom(id: string, host: boolean, play = false) {
  const key = `${id}:${host}:${play}`;
  const pending = connecting.get(key);
  if (pending) return pending;
  const payload = play ? { host, play } : { host };
  const work = appRequest<GameRoomView>(`/api/games/${id}/connect`, "POST", payload).finally(() => {
    connecting.delete(key);
  });
  connecting.set(key, work);
  return work;
}
