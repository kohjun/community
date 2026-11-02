import type { WordCategory, WordMode } from "./word-liar";
export const MBTI_TYPES = [
  "ISTJ",
  "ISFJ",
  "INFJ",
  "INTJ",
  "ISTP",
  "ISFP",
  "INFP",
  "INTP",
  "ESTP",
  "ESFP",
  "ENFP",
  "ENTP",
  "ESTJ",
  "ESFJ",
  "ENFJ",
  "ENTJ",
] as const;
export type Mbti = (typeof MBTI_TYPES)[number];
export const MBTI_SITUATIONS = [
  "여행 중 예약한 식당이 갑자기 문을 닫았어요. 어떻게 하시겠어요?",
  "친구가 힘든 이야기를 꺼냈어요. 어떤 말과 행동으로 반응할까요?",
  "약속 장소에 가장 먼저 왔는데 아무도 연락이 없어요. 어떻게 할까요?",
  "계획에 없던 번개 모임이 갑자기 생겼어요. 여러분의 반응은?",
  "조별 과제 마감이 하루 남았는데 아직 시작하지 못했어요. 무엇부터 할까요?",
  "낯선 사람이 많은 파티에 왔어요. 첫 5분을 어떻게 보내나요?",
  "친구에게 깜짝 선물을 준비하려고 해요. 어떤 방식으로 준비할까요?",
  "함께 보던 영화의 결말을 두고 의견이 갈렸어요. 어떻게 이야기할까요?",
  "갑자기 하루의 자유 시간이 생겼어요. 오늘 무엇을 하실 건가요?",
  "팀 게임에서 아슬아슬하게 졌어요. 팀원들에게 어떤 말을 할까요?",
];
export type MbtiState = {
  words?: { category: WordCategory; mode: WordMode };
  revealLiar: boolean;
  stage: "lobby" | "acting" | "voting" | "tally" | "guess" | "result" | "aborted";
  common: string | null;
  odd: string | null;
  liar: string | null;
  roster: { id: string; nickname: string }[];
  deck: number[];
  cycle: number;
  turn: number;
  endsAt: number | null;
  votes: Record<string, string | null>;
  tally: {
    suspect: string | null;
    count: number;
    outcome: "no-majority" | "wrong" | "liar";
  } | null;
  guess: string | null;
  winner: "liar" | "players" | null;
};
export type MbtiView = {
  words?: { category: WordCategory; mode: WordMode };
  revealLiar: boolean;
  stage: MbtiState["stage"];
  cycle: number;
  serverNow: number;
  scenario: string;
  roster: MbtiState["roster"];
  speakerId: string | null;
  endsAt: number | null;
  assignment: string | null;
  isLiar: boolean | null;
  voteCount: number;
  hasVoted: boolean;
  myVote: string | null;
  majority: number;
  tally: MbtiState["tally"];
  liarId: string | null;
  canGuess: boolean;
  result: { common: string; odd: string; guess: string; winner: "liar" | "players" } | null;
};
