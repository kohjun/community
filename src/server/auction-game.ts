import { randomInt } from "node:crypto";
import {
  AUCTION_BID_STEP,
  type AuctionSettings,
  type AuctionState,
  type AuctionView,
} from "../domain/auction-game";
import { AUCTION_ITEMS } from "./auction-items";
import { AppError } from "./errors";
function conflict(message: string): never {
  throw new AppError("CONFLICT", message);
}
export function newAuction(settings: AuctionSettings): AuctionState {
  return {
    settings: { ...settings },
    stage: "lobby",
    round: 0,
    roster: [],
    deck: [],
    lot: null,
    history: [],
  };
}
function beginLot(s: AuctionState) {
  if (!s.deck.length) {
    s.deck = AUCTION_ITEMS.map((_, i) => i);
    for (let i = s.deck.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [s.deck[i], s.deck[j]] = [s.deck[j]!, s.deck[i]!];
    }
  }
  const seller = s.roster[(s.round - 1) % s.roster.length]!;
  const appraisal = randomInt(5, 31) * AUCTION_BID_STEP;
  s.lot = {
    sellerId: seller.id,
    item: { ...AUCTION_ITEMS[s.deck.pop()!]! },
    appraisal,
    highestBid: 0,
    highestBidder: null,
    bidCount: 0,
    bids: [],
    endsAt: null,
    hardEndsAt: null,
  };
  s.stage = "pitch";
  // Procurement is allowed on credit; buyers still cannot spend more than their cash.
  seller.cash -= appraisal;
}
export function startAuction(s: AuctionState, roster: { id: string; nickname: string }[]) {
  if (
    s.stage !== "lobby" ||
    roster.length < 3 ||
    roster.length > 30 ||
    new Set(roster.map((p) => p.id)).size !== roster.length
  )
    conflict("최소 3명이 준비한 대기실에서 시작해주세요.");
  if (s.settings.maxRounds <= roster.length)
    conflict("총 라운드 수는 실제 참가자 수보다 많아야 해요.");
  s.roster = roster.map((p) => ({ ...p, cash: s.settings.initialMoney }));
  s.round = 1;
  s.history = [];
  s.deck = [];
  beginLot(s);
}
export function openAuction(s: AuctionState, round: number, now: number) {
  if (s.stage !== "pitch" || s.round !== round || !s.lot)
    conflict("현재 물건의 소개를 마친 뒤 입찰을 열어주세요.");
  s.stage = "bidding";
  s.lot.endsAt = now + s.settings.bidSeconds * 1000;
  s.lot.hardEndsAt = s.lot.endsAt + 30_000;
}
export function bidAuction(
  s: AuctionState,
  id: string,
  round: number,
  amount: number,
  now: number,
) {
  if (
    s.stage !== "bidding" ||
    s.round !== round ||
    !s.lot ||
    s.lot.endsAt === null ||
    now >= s.lot.endsAt
  )
    conflict("입찰 시간이 끝났거나 다른 라운드예요.");
  const bidder = s.roster.find((p) => p.id === id);
  if (!bidder || s.lot.sellerId === id)
    throw new AppError("FORBIDDEN", "이번 판매자는 자신의 물건에 입찰할 수 없어요.");
  if (
    !Number.isSafeInteger(amount) ||
    amount % AUCTION_BID_STEP !== 0 ||
    amount < s.lot.highestBid + AUCTION_BID_STEP
  )
    conflict(`현재 최고가보다 ${AUCTION_BID_STEP}G 이상 높게 입찰해주세요.`);
  if (amount > bidder.cash) conflict("보유한 게임 머니 안에서 입찰해주세요.");
  if (s.lot.highestBidder === id) conflict("이미 최고 입찰자예요. 다른 입찰을 기다려주세요.");
  s.lot.highestBid = amount;
  s.lot.highestBidder = id;
  s.lot.bidCount++;
  s.lot.bids = [...s.lot.bids, { playerId: id, amount }].slice(-20);
  if (s.lot.endsAt - now < 5_000) s.lot.endsAt = Math.min(now + 5_000, s.lot.hardEndsAt!);
}
export function settleAuction(s: AuctionState) {
  if (!s.lot || !["pitch", "bidding"].includes(s.stage)) conflict("정산할 경매가 없어요.");
  if (s.history.some((h) => h.round === s.round)) conflict("이미 정산한 라운드예요.");
  const lot = s.lot,
    seller = s.roster.find((p) => p.id === lot.sellerId)!;
  const buyer = lot.highestBidder ? s.roster.find((p) => p.id === lot.highestBidder) : null;
  if (buyer) {
    if (buyer.id === seller.id || buyer.cash < lot.highestBid)
      conflict("거래 금액을 확인해주세요.");
    buyer.cash -= lot.highestBid;
    seller.cash += lot.highestBid;
  } else seller.cash += lot.appraisal;
  s.history.push({
    round: s.round,
    sellerId: seller.id,
    buyerId: buyer?.id ?? null,
    item: { ...lot.item },
    appraisal: lot.appraisal,
    price: buyer ? lot.highestBid : 0,
    outcome: buyer ? "sold" : "unsold",
  });
  lot.endsAt = null;
  lot.hardEndsAt = null;
  s.stage = s.round >= s.settings.maxRounds ? "result" : "review";
}
export function tickAuction(s: AuctionState, now: number): boolean {
  if (s.stage !== "bidding" || s.lot?.endsAt == null || now < s.lot.endsAt) return false;
  settleAuction(s);
  return true;
}
export function nextAuction(s: AuctionState, round: number) {
  if (s.stage !== "review" || s.round !== round || s.round >= s.settings.maxRounds)
    conflict("이번 정산을 확인한 뒤 다음 물건으로 넘어가주세요.");
  s.round++;
  beginLot(s);
}
export function abortAuction(s: AuctionState) {
  if (["pitch", "bidding"].includes(s.stage) && s.lot)
    s.roster.find((p) => p.id === s.lot!.sellerId)!.cash += s.lot.appraisal;
  s.stage = "aborted";
  s.lot = null;
}
export function auctionView(s: AuctionState, id: string | null, now: number): AuctionView {
  const active = s.stage === "pitch" || s.stage === "bidding";
  // Add the unrevealed procurement cost back to the PUBLIC balance until settlement.
  // Otherwise the seller's cash difference reveals the appraisal to every bidder.
  const standings = s.roster
    .map((p) => {
      const purchases = s.history.filter((h) => h.buyerId === p.id && h.outcome === "sold");
      const assetValue = purchases.reduce((sum, h) => sum + h.appraisal, 0);
      const cash = p.cash + (active && s.lot?.sellerId === p.id ? s.lot.appraisal : 0);
      return {
        id: p.id,
        nickname: p.nickname,
        cash,
        assetValue,
        total: cash + assetValue,
        profit: cash + assetValue - s.settings.initialMoney,
        purchased: purchases.length,
        sold: s.history.filter((h) => h.sellerId === p.id && h.outcome === "sold").length,
        rank: 0,
      };
    })
    .sort(
      (a, b) =>
        b.total - a.total ||
        s.roster.findIndex((p) => p.id === a.id) - s.roster.findIndex((p) => p.id === b.id),
    );
  standings.forEach((p, i) => {
    p.rank = i > 0 && standings[i - 1]!.total === p.total ? standings[i - 1]!.rank : i + 1;
  });
  const me = id ? s.roster.find((p) => p.id === id) : null;
  const minimumBid = (s.lot?.highestBid ?? 0) + AUCTION_BID_STEP;
  return {
    settings: { ...s.settings },
    stage: s.stage,
    round: s.round,
    serverNow: now,
    myCash: me?.cash ?? null,
    canBid:
      s.stage === "bidding" &&
      !!me &&
      s.lot?.sellerId !== id &&
      s.lot?.highestBidder !== id &&
      me.cash >= minimumBid &&
      now < (s.lot?.endsAt ?? 0),
    standings,
    history: s.history.map((h) => ({ ...h, item: { ...h.item } })),
    winners: s.stage === "result" ? standings.filter((p) => p.rank === 1).map((p) => p.id) : [],
    lot: s.lot
      ? {
          sellerId: s.lot.sellerId,
          item: { ...s.lot.item },
          appraisal: !active || s.lot.sellerId === id ? s.lot.appraisal : null,
          highestBid: s.lot.highestBid,
          highestBidder: s.lot.highestBidder,
          bidCount: s.lot.bidCount,
          bids: s.lot.bids.map((b) => ({ ...b })),
          minimumBid,
          endsAt: s.lot.endsAt,
          hardEndsAt: s.lot.hardEndsAt,
        }
      : null,
  };
}
