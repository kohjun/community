import { gameRoomId } from "./game-room";
/** Share only a guest entry URL. Host mode, OAuth codes and browser sessions never enter the QR. */
export function gameJoinUrl(origin: string, roomId: string): string {
  const base = new URL(origin);
  if (
    !["https:", "http:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  )
    throw new Error("Invalid game invitation origin.");
  return new URL(`/games/${gameRoomId.parse(roomId)}`, base.origin).href;
}
