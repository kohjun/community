import { appRequest } from "./api-client";
import type { GameRoomView } from "../domain/game-room";
const connecting = new Map<string, Promise<GameRoomView>>();
/** Reuse Strict Mode's in-flight join so first visits cannot allocate two cookies/seats. */
export function connectGameRoom(id: string, host: boolean) {
  const key = `${id}:${host}`;
  const pending = connecting.get(key);
  if (pending) return pending;
  const work = appRequest<GameRoomView>(`/api/games/${id}/connect`, "POST", { host }).finally(
    () => {
      connecting.delete(key);
    },
  );
  connecting.set(key, work);
  return work;
}
