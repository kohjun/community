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
const artifact = process.env.SLIPER_GAME_BROWSER_OUTPUT ?? ".local/toast-browser";
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
    viewport: { width: 1440, height: 950 },
    serviceWorkers: "block",
  });
  await hc.addCookies([{ name: "game-test-host", value: hostCookie, url: origin }]);
  const hp = await hc.newPage();
  hp.on("pageerror", (e) => browserErrors.push(e.message));
  hp.on("dialog", (d) => d.accept());
  const { gameRooms } = await import("../src/db/game-room-schema.ts");
  const { eq } = await import("drizzle-orm");
  const click = async (l) => {
    await l.evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" }));
    await l.click();
  };
  let roomId;
  const raw = async () =>
    (await db.select().from(gameRooms).where(eq(gameRooms.id, roomId)))[0].toast;
  async function setup(mode) {
    await hp.goto(origin + "/games");
    await click(hp.getByRole("button", { name: "건배의 눈치 선택", exact: true }));
    await hp.getByLabel("건배 게임 모드", { exact: true }).selectOption(mode);
    await hp.getByLabel("건배 라운드 수", { exact: true }).selectOption("1");
    await hp.getByLabel("건배 선택 제한시간", { exact: true }).selectOption("15");
    await hp.getByLabel("참가 정원", { exact: true }).selectOption("3");
    await click(hp.getByRole("button", { name: "게임방 만들기", exact: true }));
    await hp.waitForURL(/games\/[a-f0-9-]+\?host=1/);
    roomId = new URL(hp.url()).pathname.split("/")[2];
    const players = [];
    for (let i = 0; i < 3; i++) {
      const ctx = await browser.newContext({
        viewport: { width: 393, height: 820 },
        isMobile: true,
        hasTouch: true,
        serviceWorkers: "block",
      });
      const p = await ctx.newPage();
      p.on("pageerror", (e) => browserErrors.push(e.message));
      await p.goto(origin + "/games/" + roomId);
      await p.getByLabel("게임 닉네임", { exact: true }).fill("건배친구" + (i + 1));
      await click(p.getByRole("button", { name: "닉네임 저장", exact: true }));
      await click(p.getByRole("button", { name: "준비 완료", exact: true }));
      players.push(p);
    }
    await click(hp.getByRole("button", { name: "게임 시작", exact: true }));
    await players[0].getByRole("textbox", { name: "건배 질문 작성", exact: true }).waitFor();
    return players;
  }
  const players = await setup("basic");
  await players[0]
    .getByRole("textbox", { name: "건배 질문 작성", exact: true })
    .fill("나는 여행 전에 일정을 미리 세우는 편이다.");
  await click(players[0].getByRole("button", { name: "질문 공개하기", exact: true }));
  for (const p of [hp, ...players])
    await p
      .getByRole("heading", { name: "나는 여행 전에 일정을 미리 세우는 편이다.", exact: true })
      .waitFor();
  await click(
    players[0]
      .getByRole("group", { name: "나의 건배 선택", exact: true })
      .getByRole("button", { name: /건배/ }),
  );
  await players[0].getByLabel("예상 건배 인원", { exact: true }).selectOption("1");
  await click(players[0].getByRole("button", { name: "선택 제출하기", exact: true }));
  const hostRaw = await hp.evaluate(
    async (id) => (await (await fetch("/api/games/" + id + "?host=1")).json()).data.toast,
    roomId,
  );
  const peerRaw = await players[1].evaluate(
    async (id) => (await (await fetch("/api/games/" + id)).json()).data.toast,
    roomId,
  );
  assert.equal(hostRaw.myAnswer, null);
  assert.equal(peerRaw.myAnswer, null);
  assert.ok(!JSON.stringify(hostRaw).includes('"cheers"'));
  assert.equal(hostRaw.submittedCount, 1);
  assert.equal(await hp.getByLabel("예상 건배 인원", { exact: true }).count(), 0);
  ok(
    "card settings, host-only start and three shared-IP guests work; the host and peers cannot see individual choice or private prediction",
  );
  for (const width of [320, 393, 720, 721, 1440]) {
    await players[1].setViewportSize({ width, height: 900 });
    assert.equal(
      await players[1].evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
    );
    await players[1].screenshot({ path: artifact + `/answering-${width}.png`, fullPage: true });
  }
  for (const p of players.slice(1)) {
    await click(
      p
        .getByRole("group", { name: "나의 건배 선택", exact: true })
        .getByRole("button", { name: /패스/ }),
    );
    await click(p.getByRole("button", { name: "선택 제출하기", exact: true }));
  }
  await hp.getByRole("heading", { name: "눈치 적중!", exact: true }).waitFor();
  assert.equal((await raw()).roster[0].score, 1);
  assert.deepEqual((await raw()).responses, {});
  await players[0].reload();
  await players[0].getByRole("heading", { name: "눈치 적중!", exact: true }).waitFor();
  ok(
    "mobile choices and 0..N prediction produce an aggregate-only exact hit; reload preserves the result and individual choices are erased",
  );
  await click(hp.getByRole("button", { name: "다음 질문으로", exact: true }));
  await players[1]
    .getByRole("textbox", { name: "건배 질문 작성", exact: true })
    .fill("나는 친구들과 게임하는 시간이 즐겁다.");
  await click(players[1].getByRole("button", { name: "질문 공개하기", exact: true }));
  gameClock = (await raw()).endsAt;
  await hp.reload();
  await hp
    .getByText("미응답 3명은 자동 패스했어요. 누구인지는 공개하지 않아요.", { exact: true })
    .waitFor();
  assert.equal((await raw()).history[1].actual, 0);
  assert.equal((await raw()).history[1].points, 0);
  await click(hp.getByRole("button", { name: "다음 질문으로", exact: true }));
  await click(hp.getByRole("button", { name: "질문 차례 건너뛰기", exact: true }));
  await hp.getByRole("heading", { name: "건배친구1 1등!", exact: true }).waitFor();
  ok(
    "server deadline automatically passes all nonresponders, missing predictions score zero, and host skip finishes the last turn without fabricated votes",
  );
  await players[0]
    .getByLabel("마지막 한마디 참가자", { exact: true })
    .selectOption((await raw()).roster[1].id);
  await players[0].getByLabel("마지막 한마디 질문", { exact: true }).selectOption("1");
  await click(players[0].getByRole("button", { name: "마지막 한마디 보내기", exact: true }));
  await hp.getByText("건배친구1 → 건배친구2", { exact: true }).waitFor();
  assert.deepEqual(
    (await raw()).roster.map((p) => p.score),
    [1, 0, 0],
  );
  assert.deepEqual((await raw()).responses, {});
  ok(
    "winner's last word broadcasts only the target and old public question, without changing scores or revealing any answer",
  );
  const advanced = await setup("target");
  const target = (await raw()).target;
  assert.ok(Number.isInteger(target));
  await advanced[0].getByText(`건배 ${target}명`, { exact: true }).waitFor();
  assert.equal(await hp.getByText(`건배 ${target}명`, { exact: true }).count(), 0);
  assert.equal(await advanced[1].getByText(`건배 ${target}명`, { exact: true }).count(), 0);
  const suggestion = advanced[0].locator('[class*="_suggestions"]').getByRole("button").first();
  await click(suggestion);
  assert.ok(
    (await advanced[0].getByRole("textbox", { name: "건배 질문 작성", exact: true }).inputValue())
      .length > 5,
  );
  await click(advanced[0].getByRole("button", { name: "질문 공개하기", exact: true }));
  for (const [i, p] of advanced.entries()) {
    const group = p.getByRole("group", { name: "나의 건배 선택", exact: true });
    await group.waitFor();
    await click(group.getByRole("button", { name: i < target ? /건배/ : /패스/ }));
    assert.equal(await p.getByLabel("예상 건배 인원", { exact: true }).count(), 0);
    await click(p.getByRole("button", { name: "선택 제출하기", exact: true }));
  }
  await hp.getByRole("heading", { name: "눈치 적중!", exact: true }).waitFor();
  assert.equal((await raw()).history[0].expected, target);
  assert.equal((await raw()).history[0].actual, target);
  assert.equal((await raw()).roster[0].score, 1);
  ok(
    "advanced mode exposes the stable random target only to its questioner, offers editable suggestions and scores against that target without prediction inputs",
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
