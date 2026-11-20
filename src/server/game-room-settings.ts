import { createHash } from "node:crypto";
import { createGameRoomSchema } from "../domain/game-room";
import type { gameRooms } from "../db/game-room-schema";
type Room = typeof gameRooms.$inferSelect;
export function roomSettings(room: Room) {
  return createGameRoomSchema.parse({
    title: room.title,
    capacity: room.capacity,
    minPlayers: room.minPlayers,
    ...(room.snapPang
      ? {
          snapPreset: room.snapPang.settings.preset,
          snapRounds: room.snapPang.settings.rounds,
          snapSeconds: room.snapPang.settings.seconds,
        }
      : {}),
    ...(room.drawing
      ? {
          drawingMode: room.drawing.settings.mode,
          drawingSets: room.drawing.settings.sets,
          drawingSeconds: room.drawing.settings.seconds,
          drawingScored: room.drawing.settings.scored,
        }
      : {}),
    ...(room.clue
      ? {
          clueMode: room.clue.settings.mode,
          clueRounds: room.clue.settings.rounds,
          clueSeconds: room.clue.settings.seconds,
          clueSource: room.clue.settings.source,
        }
      : {}),
    gameType: room.snapPang
      ? "snap-pang"
      : room.drawing
        ? "drawing"
        : room.clue
          ? "clue"
          : room.temperature
            ? "temperature"
            : room.toast
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
    ...(room.temperature
      ? {
          temperatureMode: room.temperature.settings.mode,
          temperatureRounds: room.temperature.settings.rounds,
          temperatureAnswerSeconds: room.temperature.settings.answerSeconds,
        }
      : {}),
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
