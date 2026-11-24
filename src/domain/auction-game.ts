export const AUCTION_BID_STEP = 10;
export const AUCTION_MAX_ROUNDS = 120;
export type AuctionSettings = { maxRounds: number; initialMoney: number; bidSeconds: number };
export type AuctionItem = { name: string; description: string; icon: string };
export type AuctionSale = {
  round: number;
  sellerId: string;
  buyerId: string | null;
  item: AuctionItem;
  appraisal: number;
  price: number;
  outcome: "sold" | "unsold";
};
export type AuctionState = {
  settings: AuctionSettings;
  stage: "lobby" | "pitch" | "bidding" | "review" | "result" | "aborted";
  round: number;
  roster: { id: string; nickname: string; cash: number }[];
  deck: number[];
  lot: {
    sellerId: string;
    item: AuctionItem;
    appraisal: number;
    highestBid: number;
    highestBidder: string | null;
    bidCount: number;
    bids: { playerId: string; amount: number }[];
    endsAt: number | null;
    hardEndsAt: number | null;
  } | null;
  history: AuctionSale[];
};
export type AuctionStanding = {
  id: string;
  nickname: string;
  cash: number;
  assetValue: number;
  total: number;
  profit: number;
  purchased: number;
  sold: number;
  rank: number;
};
export type AuctionView = {
  settings: AuctionSettings;
  stage: AuctionState["stage"];
  round: number;
  serverNow: number;
  myCash: number | null;
  canBid: boolean;
  standings: AuctionStanding[];
  history: AuctionSale[];
  winners: string[];
  lot: {
    sellerId: string;
    item: AuctionItem;
    appraisal: number | null;
    highestBid: number;
    highestBidder: string | null;
    bidCount: number;
    bids: { playerId: string; amount: number }[];
    minimumBid: number;
    endsAt: number | null;
    hardEndsAt: number | null;
  } | null;
};
/** How a lot plays out, in the order players will do it (the game has a single mode). */
export const AUCTION_GUIDE = {
  title: "수상한 경매장",
  emoji: "🔨",
  rules: "최종 자산 = 남은 머니 + 산 물건의 감정가",
  steps: [
    {
      title: "물건 소개",
      detail:
        "판매자는 나만 아는 감정가를 보고 물건의 매력을 말로 설득해요. 감정가만큼 머니가 먼저 빠져요.",
      action: "판매자의 설명 듣기",
    },
    {
      title: "실시간 입찰",
      detail: "나머지는 10G 단위로 더 높게 불러요. 마지막 5초에 입찰하면 시간이 조금 늘어나요.",
      action: "금액 고르고 ‘입찰하기’",
    },
    {
      title: "감정가 공개",
      detail:
        "낙찰가와 감정가를 비교해 손익이 정해져요. 아무도 안 사면 유찰, 판매자는 매입금을 돌려받아요.",
      action: "손익 확인하기",
    },
  ],
} as const;
export const AUCTION_MONEY_OPTIONS = [500, 1000, 2000, 5000, 10000] as const;
export const AUCTION_SECONDS = [30, 60, 90, 120] as const;
