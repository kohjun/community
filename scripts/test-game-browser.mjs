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
const artifact = process.env.SLIPER_GAME_BROWSER_OUTPUT ?? ".local/game-room-browser";
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
const service = gameRoomService(db, { wake: (id) => bus.publish(id) });
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
    viewport: { width: 1440, height: 1100 },
    serviceWorkers: "block",
  });
  await hc.addCookies([{ name: "game-test-host", value: hostCookie, url: origin }]);
  const hp = await hc.newPage();
  hp.on("pageerror", (e) => browserErrors.push(e.message));
  hp.on("dialog", (d) => d.accept());
  await hp.goto(`${origin}/games`);
  await hp.getByRole("button", { name: "자유 게임 대기실 선택", exact: true }).waitFor();
  await hp.getByRole("button", { name: "자유 게임 대기실 선택", exact: true }).click();
  await hp.getByLabel("방 이름").fill("브라우저 통합 게임");
  await hp.getByLabel("참가 정원").selectOption("2");
  await hp.screenshot({ path: `${artifact}/create-desktop.png`, fullPage: true });
  await hp.getByRole("button", { name: "게임방 만들기", exact: true }).click();
  await hp.waitForURL(/games\/[a-f0-9-]+\?host=1/);
  await hp.getByRole("heading", { name: "호스트 진행" }).waitFor();
  const roomId = new URL(hp.url()).pathname.split("/")[2];
  await assert.equal(
    await hp.getByRole("button", { name: "게임 시작", exact: true }).isDisabled(),
    true,
  );
  ok("host creates room without occupying a seat");
  const inlineQr = hp.getByRole("img", { name: "게임 참가 QR 코드", exact: true });
  await inlineQr.waitFor();
  const joinUrl = await hp.evaluate(async () =>
    window.__decodeGameQr(document.querySelector('img[alt="게임 참가 QR 코드"]').src),
  );
  assert.equal(joinUrl, `${origin}/games/${roomId}`);
  assert.equal(new URL(joinUrl).search, "");
  const smallPng = (await inlineQr.screenshot()).toString("base64");
  assert.equal(
    await hp.evaluate(
      async (src) => window.__decodeGameQr(src),
      `data:image/png;base64,${smallPng}`,
    ),
    joinUrl,
  );
  ok("inline QR decodes to the guest invitation, including its rendered small preview");
  const downloadReady = hp.waitForEvent("download");
  await hp.getByRole("link", { name: "QR 저장", exact: true }).click();
  const download = await downloadReady;
  assert.equal(download.suggestedFilename(), `sliper-game-${roomId}.png`);
  await download.saveAs(`${artifact}/downloaded-qr.png`);
  ok("QR invitation can be downloaded as a PNG");
  await hp.getByRole("button", { name: "QR 크게 보기", exact: true }).click();
  const presentation = hp.getByRole("dialog", { name: "브라우저 통합 게임" });
  await presentation.waitFor();
  for (const width of [320, 393, 1440]) {
    await hp.setViewportSize({ width, height: 950 });
    const box = await presentation.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1);
    const png = (
      await presentation
        .getByRole("img", { name: "게임 참가 QR 코드 크게 보기", exact: true })
        .screenshot()
    ).toString("base64");
    assert.equal(
      await hp.evaluate(async (src) => window.__decodeGameQr(src), `data:image/png;base64,${png}`),
      joinUrl,
    );
    await hp.screenshot({ path: `${artifact}/qr-presentation-${width}.png`, fullPage: true });
  }
  ok("projected QR scans at mobile and desktop sizes without horizontal overflow");
  if (await hp.evaluate(() => document.fullscreenEnabled === true)) {
    await presentation.getByRole("button", { name: "전체 화면으로 보기", exact: true }).click();
    await hp.waitForFunction(() => document.fullscreenElement !== null);
    await presentation.getByRole("button", { name: "전체 화면 나가기", exact: true }).click();
    await hp.waitForFunction(() => document.fullscreenElement === null);
    ok("projection enters and exits browser fullscreen");
  }

  const contexts = [],
    pages = [];
  for (let i = 0; i < 4; i++) {
    const c = await browser.newContext({
      viewport: { width: 393, height: 851 },
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block",
    });
    contexts.push(c);
    const page = await c.newPage();
    page.on("pageerror", (e) => browserErrors.push(e.message));
    page.on("dialog", (d) => d.accept());
    pages.push(page);
    await page.goto(joinUrl);
    await page
      .getByRole("heading", { name: i < 2 ? "함께할 준비" : "곧 자리가 나면 알려드릴게요" })
      .waitFor();
  }
  assert.equal(calls.joins, 5);
  await presentation.getByText("2 / 2명", { exact: true }).waitFor();
  await presentation.getByRole("button", { name: "닫기", exact: true }).click();
  await presentation.waitFor({ state: "hidden" });
  ok("displayed player counts update while the QR invitation remains open");
  ok("Strict Mode creates one guest per browser, shared IP and overflow queue work");
  const [a, b, c, d] = pages;
  for (const [i, p] of [a, b].entries()) {
    await p.getByLabel("게임 닉네임").fill(`모바일참가${i + 1}`);
    await p.getByRole("button", { name: "닉네임 저장", exact: true }).click();
    await p.getByRole("button", { name: "준비 완료", exact: true }).click();
  }
  await hp.waitForFunction(() =>
    [...document.querySelectorAll("button")].some(
      (b) => b.textContent.includes("게임 시작") && !b.disabled,
    ),
  );
  await a.screenshot({ path: `${artifact}/lobby-mobile.png`, fullPage: true });
  for (const p of [hp, a, b, c, d])
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  ok("nickname and readiness update host live; mobile has no horizontal overflow");
  await hp.getByRole("button", { name: "게임 시작", exact: true }).click();
  for (const p of [hp, a, b]) await p.locator('[data-game-phase="playing"]').waitFor();
  await c.getByRole("heading", { name: "다음 라운드를 기다려요" }).waitFor();
  const initial = (await a.request.get(`${origin}/api/games/${roomId}`).then((r) => r.json())).data;
  await a.reload();
  await a.locator('[data-game-phase="playing"]').waitFor();
  const repeated = (await a.request.get(`${origin}/api/games/${roomId}`).then((r) => r.json()))
    .data;
  assert.equal(repeated.viewer.id, initial.viewer.id);
  ok("all browsers enter playing together and refresh preserves the seat");
  await hp.getByRole("button", { name: "이번 라운드 종료", exact: true }).click();
  await hp.getByRole("button", { name: "다음 라운드 준비", exact: true }).click();
  await b.getByRole("heading", { name: "함께할 준비" }).waitFor();
  await a.getByRole("button", { name: "방 나가기", exact: true }).click();
  await c.getByRole("heading", { name: "함께할 준비" }).waitFor();
  await d.getByRole("heading", { name: "곧 자리가 나면 알려드릴게요" }).waitFor();
  ok("next round resets readiness and vacancy promotes first waiting guest");
  await hp.screenshot({ path: `${artifact}/host-desktop.png`, fullPage: true });
  for (const width of [320, 393, 1440]) {
    await c.setViewportSize({ width, height: 950 });
    assert.equal(await c.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  ok("320px, 393px and desktop layouts remain within viewport");
  assert.deepEqual(browserErrors, []);
  ok("no browser runtime errors");
  await hp.getByRole("button", { name: "QR 크게 보기", exact: true }).click();
  await presentation.waitFor();
  await hp.keyboard.press("Escape");
  await presentation.waitFor({ state: "hidden" });
  assert.equal(
    await hp
      .getByRole("button", { name: "QR 크게 보기", exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  ok("QR dialog closes with Escape and restores keyboard focus");
  await hp.getByRole("button", { name: "게임방 닫기", exact: true }).click();
  await c.getByRole("heading", { name: "게임방이 종료됐어요" }).waitFor();
  ok("host close propagates to every active participant");
  await writeFile(
    `${artifact}/report.json`,
    JSON.stringify(
      {
        status: "passed",
        checks,
        calls,
        browserErrors,
        persistence: "isolated PGlite PostgreSQL engine",
        transport: "actual SSE with in-memory test wake bus",
        productionTouched: false,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: "passed", checks: checks.length, calls }));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await pg.close();
}
