import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as base from "../src/db/schema";
import { contentRestrictions } from "../src/db/safety-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import type { GameRoomView } from "../src/domain/game-room";
import { extractGameShareSummary, isGameResultReady } from "../src/domain/game-share-card";
import { buildSearchSuggestions, sanitizeKeyword } from "../src/domain/search-trends";
import { clearSearchTrendsCache, searchTrendsService } from "../src/server/search-trends-service";

function baseRoom(overrides: Partial<GameRoomView> = {}): GameRoomView {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    title: "금요일 술자리 한 판",
    capacity: 8,
    minPlayers: 2,
    phase: "finished",
    revision: 5,
    round: 1,
    startedAt: "2026-11-24T10:00:00Z",
    expiresAt: "2026-11-25T10:00:00Z",
    isHost: false,
    canStart: false,
    waitingCount: 0,
    readyCount: 3,
    viewer: {
      id: "p2",
      status: "admitted",
      nickname: "민수",
      ready: true,
      queuePosition: null,
    },
    players: [
      { id: "p1", nickname: "지은", ready: true, online: true },
      { id: "p2", nickname: "민수", ready: true, online: true },
      { id: "p3", nickname: "현우", ready: true, online: true },
    ],
    waiting: [],
    ...overrides,
  };
}

test("extractGameShareSummary supports snap-pang, auction and word-liar without leaking room UUIDs", () => {
  const lobbyRoom = baseRoom({ phase: "lobby" });
  assert.equal(isGameResultReady(lobbyRoom), false);

  const snapRoom = baseRoom({
    gameType: "snap-pang",
    snapPang: {
      settings: { preset: "random", rounds: 5, seconds: 20 },
      stage: "result",
      runId: "run-1",
      phaseId: "phase-1",
      round: 5,
      totalRounds: 5,
      roster: [
        { id: "p1", nickname: "지은", score: 4200, color: "#FF6B35" },
        { id: "p2", nickname: "민수", score: 3100, color: "#3B82F6" },
        { id: "p3", nickname: "현우", score: 1900, color: "#10B981" },
      ],
      mission: null,
      roundStartedAt: null,
      endsAt: null,
      paused: false,
      serverNow: Date.now(),
      mySubmission: null,
      submittedCount: 3,
      expectedCount: 3,
      tensions: {},
      lastResult: null,
      history: [],
    },
  });
  assert.equal(isGameResultReady(snapRoom), true);
  const snapSummary = extractGameShareSummary(snapRoom, "https://sliper.kr");
  assert.equal(snapSummary.gameId, "snap-pang");
  assert.equal(snapSummary.shareUrl, "https://sliper.kr/games?game=snap-pang");
  assert.equal(snapSummary.shareUrl.includes(snapRoom.id), false);
  assert.equal(snapSummary.podium[0]?.nickname, "지은");
  assert.equal(snapSummary.podium[0]?.rank, 1);
  assert.equal(snapSummary.myHighlight?.nickname, "민수");
  assert.equal(snapSummary.myHighlight?.rank, 2);

  const auctionRoom = baseRoom({
    gameType: "auction",
    auction: {
      settings: { maxRounds: 8, initialMoney: 1000, bidSeconds: 60 },
      stage: "result",
      round: 8,
      serverNow: Date.now(),
      myCash: 500,
      canBid: false,
      standings: [
        {
          id: "p2",
          nickname: "민수",
          cash: 500,
          assetValue: 1900,
          total: 2400,
          profit: 1400,
          purchased: 3,
          sold: 2,
          rank: 1,
        },
        {
          id: "p1",
          nickname: "지은",
          cash: 900,
          assetValue: 600,
          total: 1500,
          profit: 500,
          purchased: 1,
          sold: 2,
          rank: 2,
        },
      ],
      history: [],
      winners: ["p2"],
      lot: null,
    },
  });
  const auctionSummary = extractGameShareSummary(auctionRoom, "https://sliper.kr");
  assert.equal(auctionSummary.headline.includes("민수"), true);
  assert.equal(auctionSummary.myHighlight?.rank, 1);
  assert.equal(auctionSummary.shareUrl, "https://sliper.kr/games?game=auction");

  const liarRoom = baseRoom({
    gameType: "word-liar",
    mbti: {
      words: { category: "food", mode: "classic" },
      revealLiar: false,
      stage: "result",
      cycle: 1,
      serverNow: Date.now(),
      scenario: "",
      roster: [
        { id: "p1", nickname: "지은" },
        { id: "p2", nickname: "민수" },
      ],
      speakerId: null,
      endsAt: null,
      assignment: "김치찌개",
      isLiar: false,
      voteCount: 2,
      hasVoted: true,
      myVote: "p1",
      majority: 2,
      tally: null,
      liarId: "p1",
      canGuess: false,
      result: { common: "김치찌개", odd: "된장찌개", guess: "부대찌개", winner: "players" },
    },
  });
  const liarSummary = extractGameShareSummary(liarRoom, "https://sliper.kr");
  assert.equal(liarSummary.headline.includes("시민 승리"), true);
  assert.equal(liarSummary.shareUrl, "https://sliper.kr/games?game=word-liar");
});

test("sanitizeKeyword and buildSearchSuggestions filter PII, deduplicate and create dynamic placeholders", () => {
  assert.equal(sanitizeKeyword("  #보드게임 "), "보드게임");
  assert.equal(sanitizeKeyword("a"), null);
  assert.equal(sanitizeKeyword("user@example.com"), null);
  assert.equal(sanitizeKeyword("010-1234-5678"), null);
  assert.equal(sanitizeKeyword("https://evil.example"), null);

  const built = buildSearchSuggestions([
    { keyword: "#강남번개", badge: "인기" },
    { keyword: "강남번개", badge: "인기" },
    { keyword: "추리", badge: "인기" },
    { keyword: "secret@email.com", badge: "인기" },
  ]);
  assert.equal(built.popular[0]?.keyword, "강남번개");
  assert.equal(built.popular.filter((item) => item.keyword === "강남번개").length, 1);
  assert.equal(
    built.popular.some((item) => item.keyword.includes("@")),
    false,
  );
  assert.ok(built.placeholders.length >= 5);
  assert.ok(built.placeholders[0]?.prompt.includes("강남번개"));
});

const pg = new PGlite();
const db = drizzle(pg, { schema: base });
const trends = searchTrendsService(db as unknown as Database, { useCache: false });

before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(base.categories).values([...CATEGORIES]);
});

beforeEach(async () => {
  clearSearchTrendsCache();
  await pg.exec("truncate auth.users cascade");
});

after(() => pg.close());

test("searchTrendsService aggregates live published tags and excludes sample, spoiler and hidden posts", async () => {
  const authorId = randomUUID();
  await pg.query("insert into auth.users values($1)", [authorId]);
  await db.insert(base.profiles).values({ id: authorId, nickname: "트렌드작성자" });

  await db.insert(base.posts).values([
    {
      authorId,
      kind: "이야기",
      categorySlug: "party",
      title: "성수 추리 모임 후기 1",
      bodyMarkdown: "정말 재미있었던 성수 추리 모임 후기입니다.",
      tags: ["성수파티", "크라임씬"],
    },
    {
      authorId,
      kind: "이야기",
      categorySlug: "party",
      title: "성수 추리 모임 후기 2",
      bodyMarkdown: "또 가고 싶은 성수 모임이에요.",
      tags: ["성수파티"],
    },
    {
      authorId,
      kind: "이야기",
      categorySlug: "party",
      title: "샘플 글",
      bodyMarkdown: "샘플 태그는 노출되면 안 됩니다.",
      tags: ["샘플금지태그"],
      sample: true,
    },
    {
      authorId,
      kind: "이야기",
      categorySlug: "mind-games",
      title: "스포일러 글",
      bodyMarkdown: "스포일러 태그는 노출되면 안 됩니다.",
      spoiler: true,
      spoilerTitle: "스포 주의",
      spoilerSummary: "범인 스포일러",
      tags: ["스포금지태그"],
    },
  ]);

  const [hiddenPost] = await db
    .insert(base.posts)
    .values({
      authorId,
      kind: "이야기",
      categorySlug: "party",
      title: "숨김 글",
      bodyMarkdown: "숨김 글의 태그는 노출되면 안 됩니다.",
      tags: ["숨김금지태그"],
    })
    .returning();
  await db.insert(contentRestrictions).values({
    targetType: "post",
    targetId: hiddenPost!.id,
    hidden: true,
    reason: "숨김 테스트",
  });

  const result = await trends.suggestions();
  assert.equal(result.popular[0]?.keyword, "성수파티");
  assert.ok(result.popular.some((item) => item.keyword === "크라임씬"));
  assert.equal(
    result.popular.some((item) =>
      ["샘플금지태그", "스포금지태그", "숨김금지태그"].includes(item.keyword),
    ),
    false,
  );
  assert.ok(result.placeholders.some((item) => item.keyword === "성수파티"));
});
