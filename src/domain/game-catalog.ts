export type CatalogGameId = "mbti-intro" | "auction" | "word-liar" | "lobby" | "toast";
export const GAME_GENRES = [
  "전체",
  "아이스브레이킹",
  "심리·추리",
  "경매·전략",
  "자유 진행",
] as const;
export type GameGenre = (typeof GAME_GENRES)[number];
export type CatalogGame = {
  id: CatalogGameId;
  title: string;
  roomTitle: string;
  genre: Exclude<GameGenre, "전체">;
  eyebrow: string;
  summary: string;
  hook: string;
  players: string;
  format: string;
  tags: readonly string[];
  highlights: readonly string[];
};
// Public, static discovery metadata. Game rules and secret round data stay on the server.
export const GAME_CATALOG: readonly CatalogGame[] = [
  {
    id: "toast",
    title: "건배의 눈치",
    roomTitle: "건배의 눈치",
    genre: "아이스브레이킹",
    eyebrow: "HOW MANY WILL CHEER?",
    summary: "나를 포함해 몇 명이 건배할까요? 서로의 생각을 읽어봐요.",
    hook: "질문 하나로 시작하는 비공개 눈치게임",
    players: "3~30명",
    format: "기본·심화 2가지 모드",
    tags: ["질문", "눈치", "비공개 선택"],
    highlights: [
      "차례로 질문자가 되어 직접 쓰거나 추천 질문을 골라요.",
      "기본은 건배 인원 예측, 심화는 목표 인원에 맞는 질문 만들기예요.",
      "개인 선택은 숨기고 전체 건배 인원만 공개해요. 맞히면 질문자 +1점!",
    ],
  },
  {
    id: "mbti-intro",
    title: "MBTI 자기소개 게임",
    roomTitle: "MBTI 자기소개 게임",
    genre: "아이스브레이킹",
    eyebrow: "GET TO KNOW YOU",
    summary: "이야기를 듣고, 서로의 MBTI를 맞혀보세요.",
    hook: "처음 만난 사이에도 대화가 시작되는 게임",
    players: "3~30명",
    format: "1~10라운드",
    tags: ["자기소개", "대화", "탈락 없음"],
    highlights: [
      "같은 상황에 어떻게 행동할지 차례로 소개해요.",
      "다른 사람들의 MBTI를 추리하고, 맞힌 개수로 힌트를 얻어요.",
      "전원을 먼저 맞히거나 마지막 라운드가 끝나면 모두 공개해요.",
    ],
  },
  {
    id: "auction",
    title: "수상한 경매장",
    roomTitle: "수상한 경매장",
    genre: "경매·전략",
    eyebrow: "BID. BLUFF. WIN.",
    summary: "판매자의 설득, 구매자의 판단. 진짜 가치는 얼마일까요?",
    hook: "말솜씨와 눈치로 가치를 만드는 경매 심리전",
    players: "3~30명",
    format: "실시간 공개 입찰",
    tags: ["설득", "게임 머니", "전략"],
    highlights: [
      "돌아가며 판매자가 되어 물건을 소개해요.",
      "구매자들은 보유 머니 안에서 공개 입찰해요.",
      "낙찰 후 감정가를 공개하고, 남은 머니와 물건 가치로 순위를 정해요.",
    ],
  },
  {
    id: "word-liar",
    title: "제시어 라이어 게임",
    roomTitle: "제시어 라이어 게임",
    genre: "심리·추리",
    eyebrow: "TRUST NO ONE?",
    summary: "비슷한 설명 속, 정체를 숨긴 라이어를 찾아보세요.",
    hook: "한마디를 듣고 의심하고, 한 표로 추리해요",
    players: "3~30명",
    format: "3가지 라이어 방식",
    tags: ["제시어", "눈치", "투표"],
    highlights: [
      "카테고리와 라이어 방식을 골라 시작해요.",
      "제시어를 직접 말하지 않고 특징이나 경험을 설명해요.",
      "과반수 투표로 라이어를 찾고, 라이어는 마지막 제시어 추리에 도전해요.",
    ],
  },
  {
    id: "lobby",
    title: "자유 게임 대기실",
    roomTitle: "오늘의 예능 게임",
    genre: "자유 진행",
    eyebrow: "YOUR ROOM, YOUR RULES",
    summary: "직접 준비한 게임이 있나요? 모이는 건 Sliper에 맡겨요.",
    hook: "우리만의 게임을 위한 간편한 시작 공간",
    players: "2~30명",
    format: "진행자가 직접 진행",
    tags: ["자유 규칙", "대기열", "준비 확인"],
    highlights: [
      "진행자가 규칙과 미션을 직접 준비해요.",
      "링크·QR로 모여 닉네임을 정하고 준비 상태를 확인해요.",
      "준비가 끝나면 호스트가 시작해요. 자동 문제·점수 집계는 없어요.",
    ],
  },
];
