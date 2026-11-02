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
