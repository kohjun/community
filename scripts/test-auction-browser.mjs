import assert from "node:assert/strict";
import http from "node:http";
import { Readable } from "node:stream";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
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
const artifact = process.env.SLIPER_GAME_BROWSER_OUTPUT ?? ".local/auction-browser";
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
      '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>*{box-sizing:border-box}body{margin:0;background:#f9fafc;font-family:Pretendard,Arial,sans-serif;padding:24px}#root{max-width:1000px;margin:auto}button,input,select{font-family:inherit}.dialog-overlay{position:fixed;inset:0;background:#10243c55;z-index:100}.dialog-content{z-index:101}.dialog-close{position:absolute;top:12px;right:12px;border:0;background:#f3f6fa;width:36px;height:36px;border-radius:50%}@media(max-width:700px){body{padding:16px}}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
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
  hp.on("dialog", (d) => d.accept());
  await hp.goto(origin + "/games");
  await hp.getByRole("button", { name: "수상한 경매장 선택", exact: true }).click();
  await hp.getByLabel("참가 정원", { exact: true }).selectOption("3");
  await hp.getByLabel("총 경매 라운드", { exact: true }).fill("4");
  await hp.getByLabel("물건당 입찰 시간", { exact: true }).selectOption("30");
  await hp.screenshot({ path: artifact + "/create-desktop.png", fullPage: true });
  await hp.getByRole("button", { name: "게임방 만들기", exact: true }).click();
  await hp.waitForURL(/games\/[a-f0-9-]+\?host=1/);
  const roomId = new URL(hp.url()).pathname.split("/")[2],
    participants = [];
  for (let i = 0; i < 3; i++) {
    const c = await browser.newContext({
      viewport: { width: 393, height: 950 },
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block",
    });
    const p = await c.newPage();
    p.on("pageerror", (e) => browserErrors.push(e.message));
    p.on("dialog", (d) => d.accept());
    await p.goto(origin + "/games/" + roomId);
    await p.getByLabel("게임 닉네임", { exact: true }).fill("경매친구" + (i + 1));
    await p.getByRole("button", { name: "닉네임 저장", exact: true }).click();
    await p.getByRole("button", { name: "준비 완료", exact: true }).click();
    participants.push(p);
  }
  await hp.getByRole("button", { name: "게임 시작", exact: true }).click();
  await hp.getByRole("button", { name: "소개 완료 · 입찰 시작", exact: true }).waitFor();
  const { gameRooms } = await import("../src/db/game-room-schema.ts"),
    { eq } = await import("drizzle-orm");
  const raw = async () =>
    (await db.select().from(gameRooms).where(eq(gameRooms.id, roomId)))[0].auction;
  const first = await raw(),
    value = first.lot.appraisal;
  await participants[0].getByRole("button", { name: "감정가 보기", exact: true }).click();
  assert.equal(
    await participants[0].getByText(value.toLocaleString("ko-KR") + "G", { exact: true }).count(),
    1,
  );
  assert.equal(await hp.getByRole("button", { name: "감정가 보기", exact: true }).count(), 0);
  const hostView = await hp.evaluate(
    async (id) => (await (await fetch("/api/games/" + id + "?host=1")).json()).data,
    roomId,
  );
  assert.equal(hostView.auction.lot.appraisal, null);
  assert.ok(hostView.auction.standings.every((p) => p.cash === 1000));
  assert.ok(!js.includes("절대 식지 않는 머그컵"));
  ok(
    "creation, shared-IP guest readiness and seller-only appraisal work; public wallet masks procurement cost and no item bank is bundled",
  );
  await hp.screenshot({ path: artifact + "/pitch-host.png", fullPage: true });
  await participants[0].screenshot({ path: artifact + "/pitch-seller-mobile.png", fullPage: true });
  await hp.getByRole("button", { name: "소개 완료 · 입찰 시작", exact: true }).click();
  await participants[1].getByLabel("입찰 금액", { exact: true }).fill(String(value + 40));
  await participants[1]
    .getByRole("button", { name: `${(value + 40).toLocaleString("ko-KR")}G 입찰하기`, exact: true })
    .click();
  await hp.getByText("경매친구2 님이 앞서고 있어요", { exact: true }).waitFor();
  const stale = await participants[2].evaluate(
    async ({ id, amount }) => {
      const r = await fetch("/api/games/" + id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "auction-bid", round: 1, amount }),
      });
      return r.status;
    },
    { id: roomId, amount: value + 40 },
  );
  assert.equal(stale, 409);
  await participants[2].getByLabel("입찰 금액", { exact: true }).fill(String(value + 60));
  await participants[2]
    .getByRole("button", { name: `${(value + 60).toLocaleString("ko-KR")}G 입찰하기`, exact: true })
    .click();
  await hp.getByText("경매친구3 님이 앞서고 있어요", { exact: true }).waitFor();
  for (const width of [320, 393, 720, 721, 1440]) {
    await participants[1].setViewportSize({ width, height: 950 });
    assert.equal(
      await participants[1].evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
    );
    await participants[1].screenshot({ path: artifact + `/bidding-${width}.png`, fullPage: true });
  }
  ok(
    "live bidding propagates over SQL/SSE; stale equal bids fail without charging and responsive auction controls fit all five widths",
  );
  await hp.getByRole("button", { name: "지금 경매 마감", exact: true }).click();
  await hp.getByText("낙찰 완료", { exact: true }).waitFor();
  const settled = await raw();
  assert.equal(settled.roster[0].cash, 1060);
  assert.equal(settled.roster[2].cash, 940 - value);
  assert.equal(settled.history[0].appraisal, value);
  await hp.screenshot({ path: artifact + "/settlement-host.png", fullPage: true });
  const debtState = await raw();
  const previousMoney = debtState.roster[1].cash;
  debtState.roster[1].cash = -20;
  debtState.roster[0].cash += previousMoney + 20;
  await db.update(gameRooms).set({ auction: debtState }).where(eq(gameRooms.id, roomId));
  await hp.getByRole("button", { name: "다음 물건으로", exact: true }).click();
  await participants[1]
    .getByText("매입금으로 잔액이 마이너스예요. 유찰이면 해당 매입금은 환급돼요.", { exact: true })
    .waitFor();
  assert.equal((await raw()).roster[1].cash, -20 - (await raw()).lot.appraisal);
  await participants[1].screenshot({
    path: artifact + "/negative-wallet-mobile.png",
    fullPage: true,
  });
  await hp.getByRole("button", { name: "소개 완료 · 입찰 시작", exact: true }).click();
  gameClock += 31000;
  await service.read(roomId, {
    actor: owner,
    identityHash: "a".repeat(64),
    networkHash: "b".repeat(64),
  });
  await bus.publish(roomId);
  await hp.getByText("이번 경매는 유찰", { exact: true }).waitFor();
  assert.equal((await raw()).history[1].outcome, "unsold");
  assert.equal((await raw()).roster[1].cash, -20);
  ok(
    "a seller with a negative balance still sells and an unsold lot refunds exactly its procurement cost",
  );
  ok(
    "host close settles real balances and reveals value; server timeout safely refunds an unsold lot",
  );
  await hp.getByRole("button", { name: "다음 물건으로", exact: true }).click();
  await hp.getByRole("button", { name: "소개 완료 · 입찰 시작", exact: true }).click();
  const third = await raw();
  gameClock = third.lot.endsAt - 1000;
  await participants[0].getByLabel("입찰 금액", { exact: true }).fill("100");
  await participants[0].getByRole("button", { name: "100G 입찰하기", exact: true }).click();
  assert.ok((await raw()).lot.endsAt > third.lot.endsAt);
  gameClock = (await raw()).lot.endsAt;
  await service.read(roomId, {
    actor: owner,
    identityHash: "a".repeat(64),
    networkHash: "b".repeat(64),
  });
  await bus.publish(roomId);
  await hp.getByText("낙찰 완료", { exact: true }).waitFor();
  await hp.getByRole("button", { name: "다음 물건으로", exact: true }).click();
  await hp.getByRole("button", { name: "소개 완료 · 입찰 시작", exact: true }).click();
  await hp.getByRole("button", { name: "지금 경매 마감", exact: true }).click();
  await hp.getByRole("heading", { name: /우승!/ }).waitFor();
  const ended = await hp.evaluate(
    async (id) => (await (await fetch("/api/games/" + id + "?host=1")).json()).data,
    roomId,
  );
  assert.equal(ended.auction.history.length, 4);
  assert.equal(ended.phase, "finished");
  assert.equal(
    ended.auction.standings.reduce((sum, p) => sum + p.total, 0),
    3000,
  );
  await participants[0].reload();
  await participants[0].getByRole("heading", { name: /우승!/ }).waitFor();
  for (const width of [320, 393, 1440]) {
    await participants[0].setViewportSize({ width, height: 950 });
    assert.equal(
      await participants[0].evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
    );
    await participants[0].screenshot({ path: artifact + `/result-${width}.png`, fullPage: true });
  }
  ok(
    "last-second bidding extends safely; all rounds finish with correct wealth rankings and refresh preserves final history",
  );
  assert.deepEqual(browserErrors, []);
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
