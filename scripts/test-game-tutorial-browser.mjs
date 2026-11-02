import assert from "node:assert/strict";
import http from "node:http";
import { Readable } from "node:stream";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { profiles } from "../src/db/schema.ts";
import { gameRoomService } from "../src/server/game-room-service.ts";
import {
  GAME_COOKIE,
  issueGameSession,
  verifyGameSession,
  gameDigest,
} from "../src/server/game-session.ts";
import { openRoomEventStream } from "../src/server/room-realtime-core.ts";
const artifact = process.env.SLIPER_GAME_BROWSER_OUTPUT ?? ".local/game-tutorial-browser";
await mkdir(artifact, { recursive: true });
const decoder = await build({
  stdin: {
    contents:
      "import {BrowserQRCodeReader} from '@zxing/browser';window.__decodeGameQr=async source=>(await new BrowserQRCodeReader().decodeFromImageUrl(source)).getText();",
    resolveDir: process.cwd(),
    loader: "js",
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
});
await writeFile(`${artifact}/qr-decoder.js`, decoder.outputFiles[0].text);
const pg = new PGlite(),
  db = drizzle(pg);
await pg.exec(
  "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
);
await migrate(db, { migrationsFolder: "./drizzle" });
const owner = randomUUID();
await pg.query("insert into auth.users values($1)", [owner]);
await db.insert(profiles).values({ id: owner, nickname: "브라우저호스트" });
const listeners = new Map();
const bus = {
  subscribe(id, wake) {
    let entry = listeners.get(id);
    if (!entry) {
      entry = new Set();
      listeners.set(id, entry);
    }
    entry.add(wake);
    return {
      ready: Promise.resolve(),
      isReady: () => true,
      unsubscribe() {
        entry.delete(wake);
        if (!entry.size) listeners.delete(id);
      },
    };
  },
  async publish(id) {
    for (const wake of listeners.get(id) ?? []) wake();
  },
};
let gameClock = Date.now();
const service = gameRoomService(db, {
  now: () => new Date(gameClock),
  wake: (id) => bus.publish(id),
});
const secret = randomBytes(32).toString("hex"),
  hostCookie = randomBytes(24).toString("hex");
const bundle = await build({
  entryPoints: ["tests/browser/game-room-fixture.tsx"],
  outfile: "game-fixture.js",
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "next-fixture-boundary",
      setup(builder) {
        builder.onResolve({ filter: /^next\/(link|navigation)$/ }, ({ path }) => ({
          path,
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
          loader: "tsx",
          contents:
            path === "next/link"
              ? "export default function Link({href,children,...p}){return <a href={href} {...p}>{children}</a>}"
              : "export function usePathname(){return location.pathname}export function useRouter(){return {push:href=>location.assign(href),refresh(){}}}",
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((v) => v.path.endsWith(".js")).text,
  css = bundle.outputFiles.find((v) => v.path.endsWith(".css")).text;
const appCss =
  (await readFile("src/app/globals.css", "utf8")) +
  "\n" +
  (await readFile("src/app/participation.css", "utf8"));
let origin = "";
const calls = { joins: 0, streams: 0 },
  browserErrors = [];
const server = http.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  const url = new URL(req.url, origin || "http://127.0.0.1");
  const cookie = new Map(
    (req.headers.cookie ?? "").split(";").map((v) => {
      const i = v.indexOf("=");
      return [v.slice(0, i).trim(), v.slice(i + 1)];
    }),
  );
  const authenticated = cookie.get("game-test-host") === hostCookie;
  const json = (value, status = 200) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(value));
  };
  try {
    if (url.pathname === "/fixture.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(js);
      return;
    }
    if (url.pathname === "/app.css") {
      res.setHeader("Content-Type", "text/css");
      res.end(appCss);
      return;
    }
    if (url.pathname === "/fixture.css") {
      res.setHeader("Content-Type", "text/css");
      res.end(css);
      return;
    }
    if (url.pathname === "/api/auth/session") {
      json({
        ok: true,
        data: { available: true, authenticated, nickname: authenticated ? "브라우저호스트" : null },
      });
      return;
    }
    if (url.pathname.startsWith("/api/games")) {
      if (req.method !== "GET" && req.headers.origin !== origin) {
        json({ ok: false, error: { code: "FORBIDDEN", message: "잘못된 요청" } }, 403);
        return;
      }
      let body;
      if (req.method !== "GET") {
        const chunks = [];
        for await (const v of req) chunks.push(v);
        body = JSON.parse(Buffer.concat(chunks).toString());
      }
      if (url.pathname === "/api/games") {
        if (!authenticated) {
          json({ ok: false, error: { code: "UNAUTHENTICATED", message: "로그인해주세요." } }, 401);
          return;
        }
        json({
          ok: true,
          data:
            req.method === "POST" ? await service.create(owner, body) : await service.mine(owner),
        });
        return;
      }
      const [, , , roomId, action] = url.pathname.split("/");
      let device = verifyGameSession(cookie.get(GAME_COOKIE), secret);
      if (!device && action === "connect") {
        const token = issueGameSession(secret);
        device = verifyGameSession(token, secret);
        res.setHeader("Set-Cookie", `${GAME_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`);
      }
      if (!device) {
        json({ ok: false, error: { code: "UNAUTHENTICATED", message: "기기 확인 필요" } }, 401);
        return;
      }
      const host = action === "connect" ? body.host : url.searchParams.get("host") === "1";
      if (host && !authenticated) {
        json({ ok: false, error: { code: "UNAUTHENTICATED", message: "호스트 로그인 필요" } }, 401);
        return;
      }
      const who = {
        actor: host ? owner : null,
        identityHash: gameDigest(secret, `player:${roomId}`, device),
        networkHash: gameDigest(secret, `network:${roomId}`, "127.0.0.1"),
      };
      if (action === "stream") {
        calls.streams++;
        const abort = new AbortController();
        res.on("close", () => abort.abort());
        const stream = await openRoomEventStream({
          roomId,
          signal: abort.signal,
          bus,
          readRoom: () => service.read(roomId, who),
        });
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();
        Readable.fromWeb(stream).pipe(res);
        return;
      }
      let data;
      if (action === "connect") {
        calls.joins++;
        data = await service.connect(roomId, who);
      } else if (req.method === "PATCH")
        data = host
          ? await service.host(roomId, who, body)
          : await service.player(roomId, who, body);
      else data = await service.read(roomId, who);
      json({ ok: true, data });
      return;
    }
    res.setHeader("Content-Type", "text/html;charset=utf-8");
    res.end(
      '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/fixture.css"><style>*{box-sizing:border-box}body{margin:0;background:#f9fafc;font-family:Pretendard,Arial,sans-serif;padding:24px}#root{max-width:1000px;margin:auto}button,input,select{font-family:inherit}.dialog-overlay{position:fixed;inset:0;background:#10243c55;z-index:100}.dialog-content{z-index:101}.dialog-close{position:absolute;top:12px;right:12px;border:0;background:#f3f6fa;width:36px;height:36px;border-radius:50%}@media(max-width:700px){body{padding:16px}}</style></head><body><div class="participation-page"><div id="root"></div></div><script src="/fixture.js"></script></body></html>',
    );
  } catch (e) {
    const code = e.code ?? "VALIDATION",
      status =
        { FORBIDDEN: 403, NOT_FOUND: 404, UNAUTHENTICATED: 401, CONFLICT: 409, RATE_LIMITED: 429 }[
          code
        ] ?? 400;
    if (!res.headersSent) json({ ok: false, error: { code, message: e.message } }, status);
    else res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const checks = [];
function ok(name) {
  checks.push(name);
  console.log(`PASS ${name}`);
}
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const hc = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    serviceWorkers: "block",
  });
  await hc.addCookies([{ name: "game-test-host", value: hostCookie, url: origin }]);
  const hp = await hc.newPage();
  hp.on("pageerror", (e) => browserErrors.push(e.message));
  const mutations = [];
  hp.on("request", (req) => {
    if (req.url().includes("/api/games") && req.method() === "POST") mutations.push(req.url());
  });
  await hp.goto(origin + "/games");
  const cases = [
    ["toast", "건배의 눈치"],
    ["mbti-intro", "MBTI 자기소개 게임"],
    ["word-liar", "제시어 라이어 게임"],
    ["auction", "수상한 경매장"],
    ["lobby", "자유 게임 대기실"],
  ];
  assert.equal(
    await hp
      .getByRole("searchbox", { name: "게임 검색", exact: true })
      .locator("..")
      .evaluate((e) => getComputedStyle(e).flexDirection),
    "row",
  );
  assert.equal(await hp.getByRole("combobox", { name: "게임 선택", exact: true }).count(), 0);
  assert.equal(await hp.getByRole("button", { name: "게임방 만들기", exact: true }).count(), 0);
  await hp.getByRole("searchbox", { name: "게임 검색", exact: true }).fill("  mbti  ");
  assert.equal(await hp.locator('button[aria-controls="game-setup"]').count(), 1);
  await hp.getByRole("searchbox", { name: "게임 검색", exact: true }).fill("없는 게임 검색");
  await hp.getByRole("status").getByText("맞는 게임을 찾지 못했어요", { exact: true }).waitFor();
  await hp.getByRole("button", { name: "전체 게임 보기", exact: true }).click();
  for (const [genre, title] of [
    ["심리·추리", "제시어 라이어 게임"],
    ["경매·전략", "수상한 경매장"],
    ["자유 진행", "자유 게임 대기실"],
  ]) {
    await hp
      .getByRole("group", { name: "게임 장르", exact: true })
      .getByRole("button", { name: genre, exact: true })
      .click();
    assert.equal(await hp.locator('button[aria-controls="game-setup"]').count(), 1);
    await hp.getByRole("button", { name: title + " 선택", exact: true }).waitFor();
  }
  await hp
    .getByRole("group", { name: "게임 장르", exact: true })
    .getByRole("button", { name: "전체", exact: true })
    .click();
  for (const width of [320, 393, 720, 1024, 1440]) {
    await hp.setViewportSize({ width, height: 900 });
    await hp.screenshot({ path: artifact + "/catalog-" + width + ".png", fullPage: true });
    assert.equal(
      await hp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
    );
    const cards = await hp.locator('button[aria-controls="game-setup"]').all();
    assert.equal(cards.length, 5);
    const first = await cards[0].boundingBox(),
      second = await cards[1].boundingBox();
    assert.ok(second.x > first.x && Math.abs(first.y - second.y) <= 1);
  }
  await hp.setViewportSize({ width: 1440, height: 1050 });
  await hp.getByRole("button", { name: "자유 게임 대기실 선택", exact: true }).focus();
  await hp.keyboard.press("Enter");
  await hp.getByRole("heading", { name: "자유 게임 대기실", exact: true, level: 2 }).waitFor();
  assert.equal(await hp.getByLabel("방 이름", { exact: true }).inputValue(), "오늘의 예능 게임");
  await hp.getByLabel("참가 정원", { exact: true }).selectOption("2");
  await hp.getByLabel("시작 최소 인원", { exact: true }).selectOption("2");
  await hp.getByRole("button", { name: "MBTI 자기소개 게임 선택", exact: true }).click();
  assert.equal(await hp.getByLabel("참가 정원", { exact: true }).inputValue(), "3");
  assert.equal(await hp.getByLabel("시작 최소 인원", { exact: true }).inputValue(), "3");
  await hp.getByRole("button", { name: "다른 게임 고르기", exact: true }).click();
  assert.equal(await hp.getByRole("button", { name: "게임방 만들기", exact: true }).count(), 0);
  ok(
    "cards replace the dropdown; search, genre filters, reset, keyboard choice and responsive gallery work without creating rooms or invalid participant limits",
  );
  const guestContext = await browser.newContext({ viewport: { width: 393, height: 800 } });
  const guest = await guestContext.newPage();
  await guest.goto(origin + "/games");
  await guest.getByRole("button", { name: "수상한 경매장 선택", exact: true }).click();
  const login = guest.getByRole("link", { name: "로그인하고 방 만들기", exact: true });
  await login.waitFor();
  assert.equal(await login.getAttribute("href"), "/login?returnTo=%2Fgames");
  assert.equal(await guest.getByRole("button", { name: "게임방 만들기", exact: true }).count(), 0);
  await guestContext.close();
  ok("guests can explore game details and tutorials but must log in before hosting");
  for (const [game, title] of cases) {
    await hp.getByRole("button", { name: title + " 선택", exact: true }).click();
    await hp.getByRole("button", { name: title + " 게임 방법 보기", exact: true }).click();
    const d = hp.getByRole("dialog", { name: title + " 플레이 가이드", exact: true });
    await d.waitFor();
    assert.equal(
      await d
        .getByRole("button", { name: "진행자 설명", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await d.getByRole("button", { name: "참가자 설명", exact: true }).click();
    const nav = d.getByRole("navigation", { name: "튜토리얼 단계", exact: true }),
      count = await nav.getByRole("button").count();
    assert.ok(count >= 3);
    for (let i = 1; i < count; i++)
      await d.getByRole("button", { name: "다음 단계", exact: true }).click();
    await d.getByRole("button", { name: "확인했어요", exact: true }).click();
    await d.waitFor({ state: "hidden" });
    assert.equal(
      await hp
        .getByRole("button", { name: title + " 게임 방법 보기", exact: true })
        .evaluate((e) => e === document.activeElement),
      true,
    );
  }
  // Use the real application CSS: its mobile dialog bottom anchoring previously
  // combined with the tutorial's centered positioning and crushed the reader.
  for (const [width, height] of [
    [320, 568],
    [393, 660],
    [667, 375],
    [720, 500],
    [721, 500],
  ]) {
    await hp.setViewportSize({ width, height });
    for (const [game, title] of cases) {
      await hp.getByRole("button", { name: title + " 선택", exact: true }).click();
      await hp.getByRole("button", { name: title + " 게임 방법 보기", exact: true }).click();
      const guide = hp.getByRole("dialog", { name: title + " 플레이 가이드", exact: true });
      const box = await guide.boundingBox();
      assert.ok(
        box.x >= -1 &&
          box.y >= -1 &&
          box.x + box.width <= width + 1 &&
          box.y + box.height <= height + 1,
      );
      if (width <= 720) assert.ok(box.height >= height - 1);
      const reader = guide.locator("[data-tutorial-scroll]");
      assert.ok(
        await reader.evaluate((e) => e.clientHeight >= 120 && e.scrollWidth <= e.clientWidth + 1),
      );
      const note = guide.locator("p").last();
      await note.evaluate((e) => e.scrollIntoView({ block: "end", behavior: "instant" }));
      const end = await note.boundingBox(),
        area = await reader.boundingBox();
      assert.ok(end.y >= area.y - 1 && end.y + end.height <= area.y + area.height + 1);
      const close = guide.getByRole("button", { name: "닫기", exact: true });
      const target = await close.boundingBox();
      assert.ok(target.y >= 0 && target.y + target.height <= height + 1);
      if (width <= 720) assert.ok(target.width >= 44 && target.height >= 44);
      await close.click();
    }
  }
  await hp.setViewportSize({ width: 1440, height: 1050 });
  ok(
    "real application dialog CSS keeps all guides readable and scrollable to the last text on short, portrait and landscape viewports with reachable close controls",
  );
  assert.equal(mutations.length, 0);
  const { gameRooms, gamePlayers } = await import("../src/db/game-room-schema.ts");
  const { eq } = await import("drizzle-orm");
  assert.equal((await db.select().from(gameRooms)).length, 0);
  ok(
    "each selectable game opens a role-aware guide, steps close and restore focus, and tutorial buttons never submit the room form",
  );
  await hp.getByRole("button", { name: "제시어 라이어 게임 선택", exact: true }).click();
  for (const [mode, text] of [
    ["classic", "제시어 없이"],
    ["undercover", "라이어 여부를 알려주지"],
    ["undercover-reveal", "라이어라는 사실도 알려줘요"],
  ]) {
    await hp.getByLabel("라이어 방식", { exact: true }).selectOption(mode);
    await hp
      .getByRole("button", { name: "제시어 라이어 게임 게임 방법 보기", exact: true })
      .click();
    const d = hp.getByRole("dialog", { name: "제시어 라이어 게임 플레이 가이드", exact: true });
    await d.getByRole("button", { name: "참가자 설명", exact: true }).click();
    assert.ok((await d.locator('[aria-live="polite"]').innerText()).includes(text));
    await d.locator("summary").filter({ hasText: "예시로 이해하기" }).click();
    await d.getByRole("button", { name: "4표 모임", exact: true }).click();
    await d.getByText("4표면 지목 확정", { exact: true }).waitFor();
    await d.getByRole("button", { name: "3표 모임", exact: true }).click();
    await d.getByText("3표는 과반수 미달", { exact: true }).waitFor();
    await d.getByRole("button", { name: "닫기", exact: true }).click();
  }
  ok(
    "all three liar modes get accurate instructions and majority practice distinguishes three versus four votes out of six",
  );
  await hp.getByRole("button", { name: "MBTI 자기소개 게임 선택", exact: true }).click();
  await hp.getByRole("button", { name: "MBTI 자기소개 게임 게임 방법 보기", exact: true }).click();
  let d = hp.getByRole("dialog", { name: "MBTI 자기소개 게임 플레이 가이드", exact: true });
  await d.locator("summary").filter({ hasText: "예시로 이해하기" }).click();
  await d.getByRole("button", { name: "예시 결과 확인", exact: true }).click();
  await d.getByRole("status").waitFor();
  assert.match(await d.getByRole("status").innerText(), /2명 O/);
  assert.match(await d.getByRole("status").innerText(), /1명 X/);
  await d.getByRole("button", { name: "닫기", exact: true }).click();
  ok("intro practice explains aggregate feedback without revealing which guess was wrong");
  await hp.getByRole("button", { name: "수상한 경매장 선택", exact: true }).click();
  await hp.getByLabel("참가 정원", { exact: true }).selectOption("3");
  await hp.getByLabel("총 경매 라운드", { exact: true }).fill("4");
  await hp.getByRole("button", { name: "게임방 만들기", exact: true }).click();
  await hp.waitForURL(/games\/[a-f0-9-]+\?host=1/);
  const roomId = new URL(hp.url()).pathname.split("/")[2],
    participants = [];
  for (let i = 0; i < 3; i++) {
    const ctx = await browser.newContext({
      viewport: { width: 393, height: 900 },
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block",
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => browserErrors.push(e.message));
    await page.goto(origin + "/games/" + roomId);
    await page.getByLabel("게임 닉네임", { exact: true }).fill("가이드친구" + (i + 1));
    await page.getByRole("button", { name: "닉네임 저장", exact: true }).click();
    if (i === 0) {
      await page.getByRole("button", { name: "수상한 경매장 게임 방법 보기", exact: true }).click();
      d = page.getByRole("dialog", { name: "수상한 경매장 플레이 가이드", exact: true });
      assert.equal(
        await d
          .getByRole("button", { name: "참가자 설명", exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
      await d.getByRole("button", { name: "닫기", exact: true }).click();
      assert.equal(
        (await db.select().from(gamePlayers).where(eq(gamePlayers.roomId, roomId))).find(
          (p) => p.nickname === "가이드친구1",
        ).ready,
        false,
      );
    }
    await page.getByRole("button", { name: "준비 완료", exact: true }).click();
    participants.push(page);
  }
  await hp.getByRole("button", { name: "게임 시작", exact: true }).click();
  await hp.getByRole("button", { name: "소개 완료 · 입찰 시작", exact: true }).waitFor();
  const before = JSON.stringify(
    (await db.select().from(gameRooms).where(eq(gameRooms.id, roomId)))[0].auction,
  );
  const player = participants[0];
  const sent = [];
  player.on("request", (req) => {
    if (req.url().includes("/api/games") && req.method() === "PATCH") {
      const b = req.postDataJSON();
      if (b.action !== "heartbeat") sent.push(b);
    }
  });
  for (const width of [320, 393, 720, 721, 1440]) {
    await player.setViewportSize({ width, height: 900 });
    await player.getByRole("button", { name: "수상한 경매장 게임 방법 보기", exact: true }).click();
    d = player.getByRole("dialog", { name: "수상한 경매장 플레이 가이드", exact: true });
    await d.getByText("설명을 보는 동안에도 실제 게임은 계속 진행돼요.", { exact: true }).waitFor();
    await d.locator("summary").filter({ hasText: "예시로 이해하기" }).click();
    await d.getByRole("button", { name: "70G 낙찰", exact: true }).click();
    await d.getByText("판매자 최종 머니 20G", { exact: true }).waitFor();
    await d.getByRole("button", { name: "140G 낙찰", exact: true }).click();
    await d.getByText("판매자 최종 머니 90G", { exact: true }).waitFor();
    await d.getByRole("button", { name: "유찰", exact: true }).click();
    await d.getByText("판매자 최종 머니 50G", { exact: true }).waitFor();
    assert.equal(await d.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), true);
    const b = await d.boundingBox();
    assert.ok(b.width <= width && b.x >= 0 && b.y >= 0 && b.y + b.height <= 901);
    await d.screenshot({ path: artifact + "/auction-guide-" + width + ".png" });
    await d.getByRole("button", { name: "닫기", exact: true }).click();
  }
  assert.equal(sent.length, 0);
  assert.equal(
    JSON.stringify((await db.select().from(gameRooms).where(eq(gameRooms.id, roomId)))[0].auction),
    before,
  );
  ok(
    "players can reopen during gameplay; auction practice demonstrates debt and exact refunds at five widths without changing real balances, bids or readiness",
  );
  const legacy = (
    await service.create(owner, {
      gameType: "mbti",
      title: "이전 위장 게임",
      capacity: 3,
      minPlayers: 3,
    })
  ).id;
  await hp.goto(origin + "/games/" + legacy + "?host=1");
  await hp.getByRole("button", { name: "MBTI 위장 게임 게임 방법 보기", exact: true }).click();
  await hp.getByRole("dialog", { name: "MBTI 위장 게임 플레이 가이드", exact: true }).waitFor();
  await hp.keyboard.press("Escape");
  assert.equal(await hp.getByRole("dialog").count(), 0);
  assert.deepEqual(browserErrors, []);
  ok("legacy MBTI rooms also have a guide, Escape closes it and no browser errors occur");
  await writeFile(
    artifact + "/report.json",
    JSON.stringify({ status: "passed", checks, browserErrors, productionTouched: false }, null, 2),
  );
  console.log(JSON.stringify({ status: "passed", checks: checks.length }));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await pg.close();
}
