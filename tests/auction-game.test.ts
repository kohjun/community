import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { before, beforeEach, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import type { Database } from "../src/db/connection";
import { profiles } from "../src/db/schema";
import { gameRooms } from "../src/db/game-room-schema";
import { gameRoomService, type GamePrincipal } from "../src/server/game-room-service";
import { createGameRoomSchema, gamePlayerActionSchema } from "../src/domain/game-room";
import {
  newAuction,
  startAuction,
  openAuction,
  bidAuction,
  settleAuction,
  tickAuction,
  nextAuction,
  abortAuction,
  auctionView,
} from "../src/server/auction-game";
import { AUCTION_ITEMS } from "../src/server/auction-items";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg);
let owner: string, roomId: string, now: Date;
const digest = () => randomBytes(32).toString("hex");
const principal = (actor: string | null = null): GamePrincipal => ({
  actor,
  identityHash: digest(),
  networkHash: digest(),
});
let host: GamePrincipal;
const service = gameRoomService(db as unknown as Database, { now: () => now });
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
const settings = { maxRounds: 4, initialMoney: 1000, bidSeconds: 30 };
const roster = () => ["가람", "나래", "다온"].map((nickname) => ({ id: randomUUID(), nickname }));
const raw = async () =>
  (await db.select().from(gameRooms).where(eq(gameRooms.id, roomId)))[0]!.auction!;
async function create(extra = {}) {
  roomId = (
    await service.create(owner, {
      title: "수상한 경매장",
      gameType: "auction",
      capacity: 3,
      minPlayers: 3,
      auctionRounds: 4,
      auctionInitialMoney: 1000,
      auctionBidSeconds: 30,
      ...extra,
    })
  ).id;
}
async function readyPlayers(count = 3) {
  const guests = Array.from({ length: count }, () => principal());
  for (const [i, who] of guests.entries()) {
    await service.connect(roomId, who);
    await service.player(roomId, who, { action: "nickname", nickname: `경매자${i + 1}` });
    await service.player(roomId, who, { action: "ready", ready: true });
  }
  return guests;
}
async function hostAction(action: string) {
  const v = await service.read(roomId, host);
  return service.host(roomId, host, {
    action,
    revision: v.revision,
    ...(action.startsWith("auction-") ? { round: v.auction!.round } : {}),
  });
}
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade");
  now = new Date("2026-10-31T01:00:00Z");
  owner = randomUUID();
  await pg.query("insert into auth.users values($1)", [owner]);
  await db.insert(profiles).values({ id: owner, nickname: "경매호스트" });
  host = principal(owner);
  await create();
});
after(() => pg.close());

test("auction settings and bids reject invalid counts, fractions, budgets, increments and injected authority", () => {
  for (const patch of [
    { auctionRounds: 3 },
    { auctionRounds: 121 },
    { auctionInitialMoney: 0 },
    { auctionInitialMoney: 555 },
    { auctionBidSeconds: 1 },
    { capacity: 31 },
  ])
    assert.equal(
      createGameRoomSchema.safeParse({
        title: "경매 테스트",
        gameType: "auction",
        capacity: 3,
        minPlayers: 3,
        ...patch,
      }).success,
      false,
    );
  for (const amount of [-10, 0, 15, 10.5, Infinity, 1_000_010])
    assert.equal(
      gamePlayerActionSchema.safeParse({ action: "auction-bid", round: 1, amount }).success,
      false,
    );
  assert.equal(
    gamePlayerActionSchema.safeParse({
      action: "auction-bid",
      round: 1,
      amount: 10,
      playerId: owner,
    }).success,
    false,
  );
  assert.equal(new Set(AUCTION_ITEMS.map((p) => p.name)).size, AUCTION_ITEMS.length);
});

test("auction projections keep appraisal and seller procurement balance private from bidders, host, queue and strangers", async () => {
  const guests = await readyPlayers();
  const queued = principal();
  await service.connect(roomId, queued);
  await hostAction("start");
  const state = await raw(),
    seller = state.roster[0]!;
  const sellerView = await service.read(roomId, guests[0]!);
  const buyerView = await service.read(roomId, guests[1]!);
  const hostView = await service.read(roomId, host);
  assert.equal(sellerView.auction!.lot!.appraisal, state.lot!.appraisal);
  assert.equal(sellerView.auction!.myCash, 1000 - state.lot!.appraisal);
  for (const v of [buyerView, hostView]) {
    assert.equal(v.auction!.lot!.appraisal, null);
    assert.equal(v.auction!.standings.find((p) => p.id === seller.id)!.cash, 1000);
    assert.ok(!Object.hasOwn(v.auction!, "deck"));
    assert.ok(!Object.hasOwn(v.auction!.lot!, "funded"));
  }
  assert.equal(hostView.auction!.myCash, null);
  for (const who of [queued, principal()])
    assert.equal((await service.read(roomId, who)).auction, null);
  assert.equal(state.roster[1]!.cash, 1000);
});

test("auction cannot start when actual player count reaches the configured round count", async () => {
  await create({ capacity: 4 });
  await readyPlayers(4);
  const v = await service.read(roomId, host);
  assert.equal(v.canStart, false);
  await assert.rejects(
    service.host(roomId, host, { action: "start", revision: v.revision }),
    code("CONFLICT"),
  );
  assert.equal((await service.read(roomId, host)).phase, "lobby");
});

test("only admitted nonseller players may bid after the host opens the current lot", async () => {
  const guests = await readyPlayers();
  await hostAction("start");
  await assert.rejects(
    service.player(roomId, guests[1]!, { action: "auction-bid", round: 1, amount: 10 }),
    code("CONFLICT"),
  );
  await hostAction("auction-open");
  await assert.rejects(
    service.player(roomId, guests[0]!, { action: "auction-bid", round: 1, amount: 10 }),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    service.player(roomId, principal(), { action: "auction-bid", round: 1, amount: 10 }),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    service.player(roomId, guests[1]!, { action: "auction-bid", round: 2, amount: 10 }),
    code("CONFLICT"),
  );
  await assert.rejects(
    service.player(roomId, guests[1]!, { action: "auction-bid", round: 1, amount: 1010 }),
    code("CONFLICT"),
  );
});

test("concurrent equal bids serialize to one leader; same leader and stale lower bids cannot double charge", async () => {
  const guests = await readyPlayers();
  await hostAction("start");
  await hostAction("auction-open");
  const outcomes = await Promise.allSettled(
    guests
      .slice(1)
      .map((who) => service.player(roomId, who, { action: "auction-bid", round: 1, amount: 100 })),
  );
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  const s = await raw();
  assert.equal(s.lot!.bidCount, 1);
  assert.equal(s.lot!.highestBid, 100);
  assert.equal(
    s.roster.slice(1).reduce((n, p) => n + p.cash, 0),
    2000,
  );
  const leader = outcomes.findIndex((x) => x.status === "fulfilled") + 1;
  await assert.rejects(
    service.player(roomId, guests[leader]!, { action: "auction-bid", round: 1, amount: 110 }),
    code("CONFLICT"),
  );
  await assert.rejects(
    service.player(roomId, guests[leader === 1 ? 2 : 1]!, {
      action: "auction-bid",
      round: 1,
      amount: 90,
    }),
    code("CONFLICT"),
  );
});

test("transaction settles seller and buyer exactly once, reveals appraisal and preserves total wealth", async () => {
  const guests = await readyPlayers();
  await hostAction("start");
  const appraisal = (await raw()).lot!.appraisal;
  await hostAction("auction-open");
  await service.player(roomId, guests[1]!, {
    action: "auction-bid",
    round: 1,
    amount: appraisal + 40,
  });
  const before = await service.read(roomId, host);
  const body = { action: "auction-close", round: 1, revision: before.revision };
  const closed = await service.host(roomId, host, body);
  assert.equal(closed.auction!.stage, "review");
  const state = await raw();
  assert.equal(state.roster[0]!.cash, 1040);
  assert.equal(state.roster[1]!.cash, 960 - appraisal);
  assert.equal(closed.auction!.lot!.appraisal, appraisal);
  assert.equal(
    closed.auction!.standings.reduce((n, p) => n + p.total, 0),
    3000,
  );
  await assert.rejects(service.host(roomId, host, body), code("CONFLICT"));
  await service.read(roomId, host);
  assert.equal((await raw()).history.length, 1);
  assert.deepEqual((await raw()).roster, state.roster);
});

test("deadline uses the server clock and repeated reads cannot duplicate automatic settlement", async () => {
  const guests = await readyPlayers();
  await hostAction("start");
  await hostAction("auction-open");
  await service.player(roomId, guests[1]!, { action: "auction-bid", round: 1, amount: 100 });
  now = new Date(now.getTime() + 30000);
  await assert.rejects(
    service.player(roomId, guests[2]!, { action: "auction-bid", round: 1, amount: 110 }),
    code("CONFLICT"),
  );
  const first = await service.read(roomId, host);
  const second = await service.read(roomId, host);
  assert.equal(first.auction!.stage, "review");
  assert.equal(second.auction!.history.length, 1);
  assert.equal(first.revision, second.revision);
});

test("unsold lots refund procurement; stale round advance cannot skip a seller", async () => {
  await readyPlayers();
  await hostAction("start");
  await hostAction("auction-open");
  const v = await hostAction("auction-close");
  assert.ok(v.auction!.standings.every((p) => p.cash === 1000));
  assert.equal(v.auction!.history[0]!.outcome, "unsold");
  const req = { action: "auction-next", revision: v.revision, round: 1 };
  const next = await service.host(roomId, host, req);
  assert.equal(next.auction!.round, 2);
  assert.equal(next.auction!.lot!.sellerId, (await raw()).roster[1]!.id);
  await assert.rejects(service.host(roomId, host, req), code("CONFLICT"));
});

test("finishing in midbid refunds only the current lot; reset clears all wealth and history", async () => {
  const guests = await readyPlayers();
  await hostAction("start");
  await hostAction("auction-open");
  await service.player(roomId, guests[1]!, { action: "auction-bid", round: 1, amount: 100 });
  const v = await hostAction("finish");
  assert.equal(v.auction!.stage, "aborted");
  assert.equal(v.auction!.lot, null);
  assert.ok(v.auction!.standings.every((p) => p.cash === 1000));
  assert.equal(v.auction!.history.length, 0);
  const reset = await hostAction("reset");
  assert.equal(reset.auction!.stage, "lobby");
  assert.equal(reset.auction!.standings.length, 0);
  assert.deepEqual(reset.auction!.settings, settings);
});

test("all configured rounds finish with no transaction when nobody bids, preserving equal shared winners", async () => {
  await readyPlayers();
  await hostAction("start");
  for (let round = 1; round <= 4; round++) {
    await hostAction("auction-open");
    const v = await hostAction("auction-close");
    if (round < 4) await hostAction("auction-next");
    else {
      assert.equal(v.phase, "finished");
      assert.equal(v.auction!.stage, "result");
      assert.equal(v.auction!.history.length, 4);
      assert.equal(v.auction!.winners.length, 3);
    }
  }
  assert.deepEqual(
    (await raw()).history.map((h) => h.sellerId),
    [
      (await raw()).roster[0]!.id,
      (await raw()).roster[1]!.id,
      (await raw()).roster[2]!.id,
      (await raw()).roster[0]!.id,
    ],
  );
});

test("disconnecting after a bid cannot evade settlement or expose a participant-only view", async () => {
  const guests = await readyPlayers();
  await hostAction("start");
  await hostAction("auction-open");
  await service.player(roomId, guests[1]!, { action: "auction-bid", round: 1, amount: 100 });
  await service.player(roomId, guests[1]!, { action: "leave" });
  assert.equal((await service.read(roomId, guests[1]!)).auction, null);
  const v = await hostAction("auction-close");
  assert.equal(v.auction!.history[0]!.buyerId, (await raw()).roster[1]!.id);
  assert.equal((await raw()).roster[1]!.cash, 900);
});

test("late bids get a bounded soft close and full histories do not grow with every bid", () => {
  const s = newAuction(settings),
    players = roster();
  startAuction(s, players);
  openAuction(s, 1, 0);
  const hardEnd = s.lot!.hardEndsAt!;
  for (let i = 0; i < 40; i++) {
    const time = s.lot!.endsAt! - 1;
    if (time >= hardEnd) break;
    bidAuction(s, players[1 + (i % 2)]!.id, 1, (i + 1) * 10, time);
  }
  assert.ok(s.lot!.endsAt! <= hardEnd);
  assert.ok(s.lot!.bids.length <= 20);
  assert.equal(tickAuction(s, hardEnd), true);
  assert.equal(tickAuction(s, hardEnd + 10), false);
  assert.equal(s.history.length, 1);
});

test("procurement may create negative cash, unsold refunds the exact cost, and abort is safe to repeat", () => {
  const s = newAuction(settings),
    players = roster();
  startAuction(s, players);
  openAuction(s, 1, 0);
  settleAuction(s);
  s.roster[1]!.cash = 10;
  nextAuction(s, 1);
  assert.equal(s.stage, "pitch");
  assert.equal(s.roster[1]!.cash, 10 - s.lot!.appraisal);
  assert.ok(s.roster[1]!.cash < 0);
  const publicView = auctionView(s, null, 0);
  assert.equal(publicView.standings.find((p) => p.id === players[1]!.id)!.cash, 10);
  assert.equal(publicView.lot!.appraisal, null);
  const mine = auctionView(s, players[1]!.id, 0);
  assert.equal(mine.myCash, 10 - s.lot!.appraisal);
  openAuction(s, 2, 0);
  settleAuction(s);
  assert.equal(s.roster[1]!.cash, 10);
  assert.equal(s.history[1]!.outcome, "unsold");
  nextAuction(s, 2);
  const before = s.roster.reduce((n, p) => n + p.cash, 0) + s.lot!.appraisal;
  abortAuction(s);
  abortAuction(s);
  assert.equal(
    s.roster.reduce((n, p) => n + p.cash, 0),
    before,
  );
});

test("SQL persists seller debt and sale proceeds; a buyer with negative cash cannot bid", async () => {
  const guests = await readyPlayers();
  await hostAction("start");
  await hostAction("auction-open");
  await hostAction("auction-close");
  const current = await raw();
  current.roster[1]!.cash = -20;
  await db.update(gameRooms).set({ auction: current }).where(eq(gameRooms.id, roomId));
  await hostAction("auction-next");
  const indebted = await raw();
  assert.equal(indebted.stage, "pitch");
  assert.equal(indebted.roster[1]!.cash, -20 - indebted.lot!.appraisal);
  const own = await service.read(roomId, guests[1]!);
  assert.equal(own.auction!.myCash, indebted.roster[1]!.cash);
  const publicBefore = await service.read(roomId, host);
  assert.equal(
    publicBefore.auction!.standings.find((p) => p.id === indebted.roster[1]!.id)!.cash,
    -20,
  );
  await hostAction("auction-open");
  await service.player(roomId, guests[0]!, { action: "auction-bid", round: 2, amount: 10 });
  await hostAction("auction-close");
  assert.equal((await raw()).roster[1]!.cash, -10 - indebted.lot!.appraisal);
  await hostAction("auction-next");
  await hostAction("auction-open");
  await assert.rejects(
    service.player(roomId, guests[1]!, { action: "auction-bid", round: 3, amount: 10 }),
    code("CONFLICT"),
  );
});

test("multi-round money and inventory conservation hold for randomized trades, unsold lots and negative cash", () => {
  const s = newAuction({ ...settings, maxRounds: 60 }),
    players = roster();
  startAuction(s, players);
  for (let round = 1; round <= 60; round++) {
    if (s.stage === "pitch") {
      openAuction(s, round, round * 1000);
      const buyer = s.roster.find((p) => p.id !== s.lot!.sellerId && p.cash >= 10);
      if (buyer && round % 3 !== 0)
        bidAuction(
          s,
          buyer.id,
          round,
          Math.min(100, Math.floor(buyer.cash / 10) * 10),
          round * 1000 + 1,
        );
      settleAuction(s);
    }
    const v = auctionView(s, null, 0);
    assert.equal(
      v.standings.reduce((n, p) => n + p.total, 0),
      3000,
    );
    assert.ok(s.roster.every((p) => Number.isSafeInteger(p.cash)));
    if (round < 60) nextAuction(s, round);
  }
  assert.equal(s.stage, "result");
  assert.equal(s.history.length, 60);
});
