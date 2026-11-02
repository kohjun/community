import { createHash } from "node:crypto";
import { createGameRoomSchema } from "../domain/game-room";
import type { gameRooms } from "../db/game-room-schema";
type Room = typeof gameRooms.$inferSelect;
export function roomSettings(room: Room) {
  return createGameRoomSchema.parse({
    title: room.title,
    capacity: room.capacity,
    minPlayers: room.minPlayers,
    gameType: room.toast
      ? "toast"
      : room.auction
        ? "auction"
        : room.intro
          ? "mbti-intro"
          : room.mbti?.words
            ? "word-liar"
            : room.mbti
              ? "mbti"
              : "lobby",
    ...(room.toast
      ? {
          toastMode: room.toast.settings.mode,
          toastRounds: room.toast.settings.rounds,
          toastAnswerSeconds: room.toast.settings.answerSeconds,
        }
      : {}),
    ...(room.auction
      ? {
          auctionRounds: room.auction.settings.maxRounds,
          auctionInitialMoney: room.auction.settings.initialMoney,
          auctionBidSeconds: room.auction.settings.bidSeconds,
        }
      : {}),
    ...(room.intro ? { maxRounds: room.intro.maxRounds } : {}),
    ...(room.mbti?.words
      ? { wordCategory: room.mbti.words.category, wordMode: room.mbti.words.mode }
      : {}),
    ...(room.mbti && !room.mbti.words ? { revealLiar: room.mbti.revealLiar } : {}),
  });
}
// Public configuration fingerprint, independent of joins / readiness / heartbeats.
// It contains no player identifiers or secret role / answer assignments.
export const roomSettingsVersion = (room: Room) =>
  createHash("sha256")
    .update(JSON.stringify(roomSettings(room)))
    .digest("hex");
