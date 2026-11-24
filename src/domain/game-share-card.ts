import { GAME_CATALOG } from "./game-catalog";
import type { GameRoomView } from "./game-room";

export interface GameShareTheme {
  bgStart: string;
  bgMid: string;
  bgEnd: string;
  accent: string;
  badge: string;
  emoji: string;
}

export interface GameShareStanding {
  rank: number;
  nickname: string;
  metric: string;
  isViewer?: boolean;
}

export interface GameShareSummary {
  gameId: string;
  gameName: string;
  roomTitle: string;
  theme: GameShareTheme;
  headline: string;
  subline: string;
  podium: GameShareStanding[];
  myHighlight: {
    nickname: string;
    rank: number | null;
    metric: string;
  } | null;
  playerCount: number;
  funTag: string;
  shareUrl: string;
  guestReturnPath: string;
}

const THEMES: Record<string, GameShareTheme> = {
  "snap-pang": {
    bgStart: "#0B1120",
    bgMid: "#1D4ED8",
    bgEnd: "#7C3AED",
    accent: "#38BDF8",
    badge: "3D CAMERA PARTY",
    emoji: "📸",
  },
  auction: {
    bgStart: "#181029",
    bgMid: "#5B21B6",
    bgEnd: "#B45309",
    accent: "#FBBF24",
    badge: "AUCTION PARTY",
    emoji: "🔨",
  },
  toast: {
    bgStart: "#1F1020",
    bgMid: "#BE185D",
    bgEnd: "#F97316",
    accent: "#FDE047",
    badge: "CHEERS QUIZ",
    emoji: "🥂",
  },
  temperature: {
    bgStart: "#0C192C",
    bgMid: "#0284C7",
    bgEnd: "#F43F5E",
    accent: "#FB7185",
    badge: "MIND TEMPERATURE",
    emoji: "🌡️",
  },
  "mbti-intro": {
    bgStart: "#0F172A",
    bgMid: "#0F766E",
    bgEnd: "#2563EB",
    accent: "#34D399",
    badge: "ICEBREAKING",
    emoji: "🧩",
  },
  "word-liar": {
    bgStart: "#111827",
    bgMid: "#3730A3",
    bgEnd: "#BE123C",
    accent: "#FB7185",
    badge: "LIAR GAME",
    emoji: "🕵️",
  },
  mbti: {
    bgStart: "#111827",
    bgMid: "#4338CA",
    bgEnd: "#0891B2",
    accent: "#67E8F9",
    badge: "MBTI LIAR",
    emoji: "🎭",
  },
  drawing: {
    bgStart: "#1E1B4B",
    bgMid: "#7C3AED",
    bgEnd: "#EC4899",
    accent: "#F9A8D4",
    badge: "DRAWING RELAY",
    emoji: "🎨",
  },
  clue: {
    bgStart: "#091A24",
    bgMid: "#0E7490",
    bgEnd: "#1D4ED8",
    accent: "#5EEAD4",
    badge: "CLUE DETECTIVE",
    emoji: "📍",
  },
  lobby: {
    bgStart: "#0F172A",
    bgMid: "#1E40AF",
    bgEnd: "#0284C7",
    accent: "#38BDF8",
    badge: "SLIPER PLAY",
    emoji: "🎮",
  },
};

export function resolveRoomGameId(room: GameRoomView): string {
  if (room.gameType) return room.gameType;
  if (room.snapPang) return "snap-pang";
  if (room.drawing) return "drawing";
  if (room.clue) return "clue";
  if (room.temperature) return "temperature";
  if (room.toast) return "toast";
  if (room.auction) return "auction";
  if (room.mbtiIntro) return "mbti-intro";
  if (room.mbti?.words) return "word-liar";
  if (room.mbti) return "mbti";
  return "lobby";
}

/** True once the room has reached a finished or result scoreboard state suitable for sharing. */
export function isGameResultReady(room: GameRoomView | null | undefined): boolean {
  if (!room) return false;
  if (room.phase === "finished") return true;
  return (
    room.snapPang?.stage === "result" ||
    room.auction?.stage === "result" ||
    room.toast?.stage === "result" ||
    room.temperature?.stage === "result" ||
    room.mbtiIntro?.stage === "result" ||
    room.mbti?.stage === "result" ||
    room.drawing?.stage === "result" ||
    room.clue?.stage === "result"
  );
}

function cleanOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return "https://sliper.kr";
  }
}

function rankByScore<T extends { id: string; nickname: string; score: number }>(
  roster: readonly T[],
  viewerId: string | null,
  unit = "점",
): GameShareStanding[] {
  const sorted = [...roster].sort(
    (a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname),
  );
  let prevScore: number | null = null;
  let currentRank = 0;
  return sorted.map((player, index) => {
    if (prevScore === null || player.score !== prevScore) {
      currentRank = index + 1;
      prevScore = player.score;
    }
    return {
      rank: currentRank,
      nickname: player.nickname,
      metric: `${player.score.toLocaleString("ko-KR")}${unit}`,
      isViewer: viewerId !== null && player.id === viewerId,
    };
  });
}

function findViewerHighlight(
  standings: GameShareStanding[],
  viewerNickname: string | null,
): GameShareSummary["myHighlight"] {
  const matched = standings.find((item) => item.isViewer);
  if (matched) {
    return { nickname: matched.nickname, rank: matched.rank, metric: matched.metric };
  }
  if (viewerNickname) {
    return { nickname: viewerNickname, rank: null, metric: "참가 완료" };
  }
  return null;
}

/**
 * Extracts a safe, PII-free shareable result summary for any Sliper web game.
 * Public share links always point to `/games?game=<id>`, never exposing private room UUIDs.
 */
export function extractGameShareSummary(
  room: GameRoomView,
  origin = "https://sliper.kr",
): GameShareSummary {
  const gameId = resolveRoomGameId(room);
  const catalog = GAME_CATALOG.find((item) => item.id === gameId);
  const gameName = catalog?.title ?? room.title;
  const theme = THEMES[gameId] ?? THEMES.lobby!;
  const safeOrigin = cleanOrigin(origin);
  const shareUrl =
    gameId === "lobby"
      ? `${safeOrigin}/games`
      : `${safeOrigin}/games?game=${encodeURIComponent(gameId)}`;
  const guestReturnPath = `/games?game=${encodeURIComponent(gameId)}`;
  const viewerId = room.viewer.id;
  const viewerNickname = room.viewer.nickname;

  if (room.snapPang) {
    const standings = rankByScore(room.snapPang.roster, viewerId, "점");
    const top = standings[0];
    return {
      gameId,
      gameName,
      roomTitle: room.title,
      theme,
      headline: top ? `오늘의 스냅 챔피언 · ${top.nickname}` : "스냅 팡 3D 한 판 완료!",
      subline: `총 ${room.snapPang.totalRounds}라운드 · ${room.snapPang.roster.length}명 테이블 대결`,
      podium: standings.slice(0, 5),
      myHighlight: findViewerHighlight(standings, viewerNickname),
      playerCount: room.snapPang.roster.length,
      funTag: "카메라로 10초 만에 분위기 터지는 3D 파티 게임",
      shareUrl,
      guestReturnPath,
    };
  }

  if (room.auction) {
    const standings: GameShareStanding[] = [...room.auction.standings]
      .sort((a, b) => a.rank - b.rank || b.total - a.total)
      .map((item) => ({
        rank: item.rank,
        nickname: item.nickname,
        metric: `${item.total.toLocaleString("ko-KR")}G`,
        isViewer: viewerId !== null && item.id === viewerId,
      }));
    const top = standings[0];
    const topProfit = room.auction.standings.find((s) => s.rank === 1)?.profit ?? 0;
    const profitSign = topProfit >= 0 ? "+" : "";
    return {
      gameId,
      gameName,
      roomTitle: room.title,
      theme,
      headline: top ? `최종 낙찰왕 · ${top.nickname}` : "수상한 경매장 결산 완료!",
      subline: top
        ? `최종 자산 ${top.metric} (${profitSign}${topProfit.toLocaleString("ko-KR")}G) · ${room.auction.standings.length}명 참가`
        : `${room.players.length}명과 심리전 경매 완료`,
      podium: standings.slice(0, 5),
      myHighlight: findViewerHighlight(standings, viewerNickname),
      playerCount: room.auction.standings.length || room.players.length,
      funTag: "감정가 속이고 입찰하는 모임 필수 심리 경매",
      shareUrl,
      guestReturnPath,
    };
  }

  if (room.toast) {
    const standings: GameShareStanding[] = [...room.toast.roster]
      .sort((a, b) => a.rank - b.rank || b.score - a.score)
      .map((item) => ({
        rank: item.rank,
        nickname: item.nickname,
        metric: `${item.score}점`,
        isViewer: viewerId !== null && item.id === viewerId,
      }));
    const top = standings[0];
    return {
      gameId,
      gameName,
      roomTitle: room.title,
      theme,
      headline: top ? `눈치 최강자 · ${top.nickname}` : "건배 퀴즈 한 판 완료!",
      subline: `${room.toast.roster.length}명 비밀 건배 · ${room.toast.round}라운드 완주`,
      podium: standings.slice(0, 5),
      myHighlight: findViewerHighlight(standings, viewerNickname),
      playerCount: room.toast.roster.length,
      funTag: "술자리·MT 어색함 10초 만에 깨는 비밀 건배 게임",
      shareUrl,
      guestReturnPath,
    };
  }

  if (room.temperature) {
    const standings = rankByScore(room.temperature.roster, viewerId, "점");
    const top = standings[0];
    return {
      gameId,
      gameName,
      roomTitle: room.title,
      theme,
      headline: top ? `마음 통함 1위 · ${top.nickname}` : "마음의 온도 측정 완료!",
      subline: `${room.temperature.roster.length}명과 취향 온도 맞추기 완료`,
      podium: standings.slice(0, 5),
      myHighlight: findViewerHighlight(standings, viewerNickname),
      playerCount: room.temperature.roster.length,
      funTag: "서로의 0~100 기준을 맞히는 취향 토크 파티 게임",
      shareUrl,
      guestReturnPath,
    };
  }

  if (room.mbtiIntro) {
    const winnerPlayer = room.mbtiIntro.roster.find((p) => p.id === room.mbtiIntro?.winner);
    const answers = room.mbtiIntro.answers ?? [];
    const podium: GameShareStanding[] = answers.slice(0, 5).map((item, index) => ({
      rank: index + 1,
      nickname: item.nickname,
      metric: item.mbti,
      isViewer: viewerId !== null && item.id === viewerId,
    }));
    return {
      gameId,
      gameName,
      roomTitle: room.title,
      theme,
      headline: winnerPlayer ? `MBTI 간파왕 · ${winnerPlayer.nickname}` : "우리들의 MBTI 대공개!",
      subline: `${room.mbtiIntro.roster.length}명 전원 MBTI 공개 완료`,
      podium,
      myHighlight: viewerNickname
        ? {
            nickname: viewerNickname,
            rank: winnerPlayer?.id === viewerId ? 1 : null,
            metric: room.mbtiIntro.myMbti ?? "공개 완료",
          }
        : null,
      playerCount: room.mbtiIntro.roster.length,
      funTag: "첫 만남 아이스브레이킹 원픽 MBTI 추리 게임",
      shareUrl,
      guestReturnPath,
    };
  }

  if (room.mbti) {
    const result = room.mbti.result;
    const liarPlayer = room.mbti.roster.find((p) => p.id === room.mbti?.liarId);
    const liarWon = result?.winner === "liar";
    const podium: GameShareStanding[] = room.mbti.roster.slice(0, 5).map((player, idx) => ({
      rank: player.id === room.mbti?.liarId ? 1 : idx + 1,
      nickname: player.nickname,
      metric: player.id === room.mbti?.liarId ? "🕵️ 라이어" : "시민",
      isViewer: viewerId !== null && player.id === viewerId,
    }));
    return {
      gameId,
      gameName,
      roomTitle: room.title,
      theme,
      headline: liarWon
        ? `라이어 승리! ${liarPlayer ? liarPlayer.nickname + " 완벽 연기" : ""}`.trim()
        : `시민 승리! ${liarPlayer ? liarPlayer.nickname + " 검거 완료" : ""}`.trim(),
      subline: result
        ? `제시어 “${result.common}” · ${room.mbti.roster.length}명 심리전`
        : `${room.mbti.roster.length}명 라이어 추리 완료`,
      podium,
      myHighlight: viewerNickname
        ? {
            nickname: viewerNickname,
            rank: null,
            metric: room.mbti.isLiar
              ? liarWon
                ? "라이어 승리"
                : "라이어 검거"
              : liarWon
                ? "아쉬운 패배"
                : "추리 성공",
          }
        : null,
      playerCount: room.mbti.roster.length,
      funTag: "설치 없이 QR로 바로 시작하는 모임 필수 라이어 게임",
      shareUrl,
      guestReturnPath,
    };
  }

  if (room.drawing) {
    const standings = rankByScore(room.drawing.roster, viewerId, "점");
    const top = standings[0];
    return {
      gameId,
      gameName,
      roomTitle: room.title,
      theme,
      headline: top ? `오늘의 화백 · ${top.nickname}` : "그림 릴레이 갤러리 완성!",
      subline: `${room.drawing.roster.length}명 그림 대참사(?) 완성`,
      podium: standings.slice(0, 5),
      myHighlight: findViewerHighlight(standings, viewerNickname),
      playerCount: room.drawing.roster.length,
      funTag: "핸드폰으로 함께 그리고 빵 터지는 그림 릴레이",
      shareUrl,
      guestReturnPath,
    };
  }

  if (room.clue) {
    const standings = rankByScore(room.clue.roster, viewerId, "점");
    const top = standings[0];
    return {
      gameId,
      gameName,
      roomTitle: room.title,
      theme,
      headline: top ? `최고의 명탐정 · ${top.nickname}` : "단서각 추리 완료!",
      subline: `${room.clue.total}문제 · ${room.clue.roster.length}명 현장 추리`,
      podium: standings.slice(0, 5),
      myHighlight: findViewerHighlight(standings, viewerNickname),
      playerCount: room.clue.roster.length,
      funTag: "거리뷰·단서로 장소를 찾아내는 실시간 추리 대결",
      shareUrl,
      guestReturnPath,
    };
  }

  const fallbackStandings: GameShareStanding[] = room.players.slice(0, 5).map((player, index) => ({
    rank: index + 1,
    nickname: player.nickname ?? `플레이어 ${index + 1}`,
    metric: "함께 플레이",
    isViewer: viewerId !== null && player.id === viewerId,
  }));
  return {
    gameId,
    gameName,
    roomTitle: room.title,
    theme,
    headline: `${room.title} 한 판 완료!`,
    subline: `${room.players.length}명과 함께한 오프라인 파티 게임`,
    podium: fallbackStandings,
    myHighlight: findViewerHighlight(fallbackStandings, viewerNickname),
    playerCount: room.players.length,
    funTag: "설치 없이 QR로 10초 만에 시작하는 모임 웹게임",
    shareUrl,
    guestReturnPath,
  };
}
