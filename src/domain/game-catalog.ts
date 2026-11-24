export type CatalogGameId =
  | "snap-pang"
  | "mbti-intro"
  | "auction"
  | "word-liar"
  | "lobby"
  | "toast"
  | "temperature"
  | "drawing"
  | "clue";
export const GAME_GENRES = [
  "전체",
  "카메라·3D 파티",
  "아이스브레이킹",
  "심리·추리",
  "경매·전략",
  "그림·창작",
  "거리뷰·추리",
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
    id: "snap-pang",
    title: "스냅 팡 3D",
    roomTitle: "스냅 팡 3D",
    genre: "카메라·3D 파티",
    eyebrow: "SNAP. POP. 3D.",
    summary: "카메라로 찍고 3D로 터뜨려요! 색깔·물건 찾기와 웃음 참기 테이블 파티.",
    hook: "얼굴 비노출 모드부터 3D 풍선 폭탄까지, 오프라인 모임 전용 3D 게임",
    players: "2~12명",
    format: "색깔·물건·표정·랜덤 모드",
    tags: ["3D 물리", "카메라", "오프라인 파티"],
    highlights: [
      "색깔 찾기: 알림으로 뜬 색깔과 같은 색 물건을 찾아 찍어요.",
      "물건 찾기: 컵·병·휴대폰 같은 물건을 카메라가 인식하면 셔터를 눌러요.",
      "웃음 참기·표정 릴레이: 웃으면 폭탄이 팡! 제시된 표정을 순서대로 지어요.",
    ],
  },
  {
    id: "drawing",
    title: "낙서톡",
    roomTitle: "낙서톡",
    genre: "그림·창작",
    eyebrow: "DRAW. PASS. GUESS.",
    summary: "그리면 전해지고, 맞히면 터진다. 우리만의 그림 파티!",
    hook: "문장이 그림으로, 그림이 뜻밖의 이야기로",
    players: "2~12명 · 방식마다 최소 인원이 달라요",
    format: "그림 맞히기 · 전달 + 맞히기 · 전달 놀이",
    tags: ["그림", "실시간", "전달"],
    highlights: [
      "🎨 그림 맞히기: 한 명이 그리면 나머지가 먼저 맞혀요. 2명부터 가장 쉽게!",
      "🔀 전달 + 맞히기: 문장과 그림을 전달하다 바뀐 마지막 문장을 다 같이 맞혀요.",
      "📜 그림 전달 놀이: 점수 없이 이야기가 바뀌는 과정을 보고 재미 투표해요.",
    ],
  },
  {
    id: "clue",
    title: "단서각",
    roomTitle: "단서각",
    genre: "거리뷰·추리",
    eyebrow: "LOOK. THINK. PIN.",
    summary: "실제 거리뷰 한 장면으로 여기가 어디인지 맞혀요.",
    hook: "이 거리, 어디인지 알겠어요?",
    players: "2~12명",
    format: "거리뷰 퀴즈·위치 찾기·줌 아웃·우리 사진",
    tags: ["거리뷰", "지도", "추리"],
    highlights: [
      "AI 사진이 아닌 실제 네이버 거리뷰를 끌어서 둘러봐요.",
      "보기에서 고르거나 지도에 핀을 꽂아 위치를 맞혀요.",
      "우리 사진 모드에서는 친구가 찍은 곳과 사진 주인을 함께 맞혀요.",
    ],
  },
  {
    id: "temperature",
    title: "마음의 온도",
    roomTitle: "마음의 온도",
    genre: "심리·추리",
    eyebrow: "WHAT'S YOUR NUMBER?",
    summary: "같은 상황을 보는 서로의 기준을 0부터 100까지 추리해요.",
    hook: "어떤 상황이 77만큼 당황스러울까요?",
    players: "3~30명",
    format: "숫자 맞히기·순서 맞히기",
    tags: ["대화", "눈치", "순서 추리"],
    highlights: [
      "숫자 맞히기: 한 명이 비밀 숫자에 맞는 상황을 말하면 나머지가 맞혀요.",
      "순서 맞히기: 모두 상황을 쓰고 낮은 숫자 순서대로 줄 세워요.",
      "가장 가까운 사람이 1점! 결과를 보며 서로의 기준을 이야기해요.",
    ],
  },
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
