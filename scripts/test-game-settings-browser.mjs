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
const artifact = process.env.SLIPER_GAME_BROWSER_OUTPUT ?? ".local/game-settings-browser";
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
  hp.on("dialog", (d) => d.accept());
  hp.on("pageerror", (e) => browserErrors.push(e.message));
  const click = async (l) => {
    await l.evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" }));
    await l.click();
  };
  let roomId;
  const guests = [];
  async function create(kind) {
    await hp.goto(origin + "/games");
    await click(
      hp.getByRole("button", {
        name:
          {
            toast: "건배의 눈치",
            "mbti-intro": "MBTI 자기소개 게임",
            auction: "수상한 경매장",
            "word-liar": "제시어 라이어 게임",
            lobby: "자유 게임 대기실",
          }[kind] + " 선택",
        exact: true,
      }),
    );
    await hp.getByLabel("참가 정원", { exact: true }).selectOption("3");
    await click(hp.getByRole("button", { name: "게임방 만들기", exact: true }));
    await hp.waitForURL(/games\/[a-f0-9-]+\?host=1/);
    roomId = new URL(hp.url()).pathname.split("/")[2];
  }
  const hostView = () =>
    hp.evaluate(
      async (id) => (await (await fetch("/api/games/" + id + "?host=1")).json()).data,
      roomId,
    );
  const guestView = (p) =>
    p.evaluate(async (id) => (await (await fetch("/api/games/" + id)).json()).data, roomId);
  async function join(i, intro = false) {
    let page = guests[i];
    if (!page) {
      const context = await browser.newContext({
        viewport: { width: 393, height: 850 },
        isMobile: true,
        hasTouch: true,
        serviceWorkers: "block",
      });
      page = await context.newPage();
      page.on("pageerror", (e) => browserErrors.push(e.message));
      guests[i] = page;
    }
    await page.goto(origin + "/games/" + roomId);
    if (i === 3) {
      await page.getByRole("heading", { name: "곧 자리가 나면 알려드릴게요" }).waitFor();
      return;
    }
    await page.getByLabel("게임 닉네임", { exact: true }).fill("설정친구" + (i + 1));
    if (intro) {
      await page.getByLabel("내 MBTI", { exact: true }).selectOption(i === 0 ? "ENFP" : "ISTJ");
    }
    await click(
      page.getByRole("button", { name: intro ? "소개 정보 저장" : "닉네임 저장", exact: true }),
    );
    await click(page.getByRole("button", { name: "준비 완료", exact: true }));
  }
  const panel = (p) => p.getByRole("region", { name: "게임방 설정", exact: true });
  await create("toast");
  for (let i = 0; i < 3; i++) await join(i);
  await join(3);
  assert.equal((await hostView()).readyCount, 3);
  await click(panel(hp).getByRole("button", { name: "설정 변경", exact: true }));
  await panel(hp).getByLabel("게임방 설정 건배 모드", { exact: true }).selectOption("target");
  await panel(hp).getByLabel("게임방 설정 건배 라운드", { exact: true }).selectOption("3");
  await panel(hp).getByLabel("게임방 설정 건배 제한시간", { exact: true }).selectOption("60");
  await panel(hp).getByLabel("게임방 설정 참가 정원", { exact: true }).selectOption("4");
  await click(guests[0].getByRole("button", { name: "준비 완료 · 취소하기", exact: true }));
  await click(guests[0].getByRole("button", { name: "준비 완료", exact: true }));
  await click(panel(hp).getByRole("button", { name: "설정 저장", exact: true }));
  await panel(guests[0]).getByText("심화 · 목표 질문", { exact: true }).waitFor();
  await guests[3].getByLabel("게임 닉네임", { exact: true }).waitFor();
  let v = await hostView();
  assert.equal(v.readyCount, 3);
  assert.equal(v.players.length, 4);
  assert.equal((await guestView(guests[0])).viewer.ready, true);
  assert.equal(
    await panel(guests[0]).getByRole("button", { name: "설정 변경", exact: true }).count(),
    0,
  );
  ok(
    "host updates toast mode/rounds/deadline/capacity while guests stay ready; settings sync and the first waiting guest is admitted unready",
  );
  for (const width of [320, 393, 720, 721, 1440]) {
    await hp.setViewportSize({ width, height: 950 });
    await click(panel(hp).getByRole("button", { name: "설정 변경", exact: true }));
    assert.equal(
      await hp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
    );
    await hp.screenshot({ path: artifact + `/settings-${width}.png`, fullPage: true });
    await click(panel(hp).getByRole("button", { name: "취소", exact: true }));
  }
  await hp.setViewportSize({ width: 1440, height: 1050 });
  const hp2 = await hc.newPage();
  await hp2.goto(origin + "/games/" + roomId + "?host=1");
  await click(panel(hp2).getByRole("button", { name: "설정 변경", exact: true }));
  await panel(hp2).getByLabel("게임방 설정 건배 라운드", { exact: true }).selectOption("8");
  await click(panel(hp).getByRole("button", { name: "설정 변경", exact: true }));
  await panel(hp).getByLabel("게임방 설정 건배 라운드", { exact: true }).selectOption("4");
  await click(panel(hp).getByRole("button", { name: "설정 저장", exact: true }));
  await panel(hp2).getByRole("alert").waitFor();
  assert.equal(
    await panel(hp2).getByRole("button", { name: "설정 저장", exact: true }).isDisabled(),
    true,
  );
  await click(panel(hp2).getByRole("button", { name: "최신 설정 불러오기", exact: true }));
  assert.equal(
    await panel(hp2).getByLabel("게임방 설정 건배 라운드", { exact: true }).inputValue(),
    "4",
  );
  await hp2.close();
  await hp.reload();
  await panel(hp).getByText("4라운드", { exact: true }).waitFor();
  assert.equal((await hostView()).readyCount, 3);
  ok(
    "host drafts survive unrelated readiness events; competing tab settings are detected, reloadable and cannot overwrite newer options; refresh persists saved values",
  );
  await guests[3].getByLabel("게임 닉네임", { exact: true }).fill("설정친구4");
  await click(guests[3].getByRole("button", { name: "닉네임 저장", exact: true }));
  await click(guests[3].getByRole("button", { name: "준비 완료", exact: true }));
  await click(hp.getByRole("button", { name: "게임 시작", exact: true }));
  v = await hostView();
  assert.equal(v.toast.settings.rounds, 4);
  assert.equal(v.toast.settings.mode, "target");
  assert.equal(v.toast.settings.answerSeconds, 60);
  assert.equal(await panel(hp).count(), 0);
  const denied = await hp.evaluate(
    async (v) =>
      (
        await fetch("/api/games/" + v.id + "?host=1", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "settings",
            settingsVersion: v.settingsVersion,
            settings: { ...v.settings, toastRounds: 9 },
          }),
        })
      ).status,
    v,
  );
  assert.equal(denied, 409);
  await click(hp.getByRole("button", { name: "게임 중단", exact: true }));
  await click(hp.getByRole("button", { name: "다음 라운드 준비", exact: true }));
  await panel(hp).getByRole("button", { name: "설정 변경", exact: true }).waitFor();
  ok(
    "the game starts with the saved options and no re-ready requirement; options are locked in play and editable again after preparing the next game",
  );
  await create("mbti-intro");
  for (let i = 0; i < 3; i++) await join(i, true);
  await click(panel(hp).getByRole("button", { name: "설정 변경", exact: true }));
  await panel(hp).getByLabel("게임방 설정 자기소개 라운드", { exact: true }).selectOption("8");
  await click(panel(hp).getByRole("button", { name: "설정 저장", exact: true }));
  assert.equal((await guestView(guests[0])).mbtiIntro.myMbti, "ENFP");
  assert.equal((await hostView()).readyCount, 3);
  await click(hp.getByRole("button", { name: "게임 시작", exact: true }));
  assert.equal((await hostView()).mbtiIntro.maxRounds, 8);
  ok(
    "changing intro rounds preserves all registered MBTI values, nicknames and ready state and starts without re-entering profiles",
  );
  for (const kind of ["auction", "word-liar", "lobby"]) {
    await create(kind);
    for (let i = 0; i < 3; i++) await join(i);
    await click(panel(hp).getByRole("button", { name: "설정 변경", exact: true }));
    if (kind === "auction") {
      await panel(hp).getByLabel("게임방 설정 경매 라운드", { exact: true }).fill("20");
      await panel(hp).getByLabel("게임방 설정 시작 머니", { exact: true }).selectOption("2000");
      await panel(hp).getByLabel("게임방 설정 입찰 시간", { exact: true }).selectOption("90");
    } else if (kind === "word-liar") {
      await panel(hp)
        .getByLabel("게임방 설정 제시어 카테고리", { exact: true })
        .selectOption("animals");
      await panel(hp)
        .getByLabel("게임방 설정 라이어 방식", { exact: true })
        .selectOption("undercover-reveal");
    } else
      await panel(hp).getByLabel("게임방 설정 방 이름", { exact: true }).fill("수정된 자유 게임방");
    await click(panel(hp).getByRole("button", { name: "설정 저장", exact: true }));
    assert.equal((await hostView()).readyCount, 3);
    await click(hp.getByRole("button", { name: "게임 시작", exact: true }));
    v = await hostView();
    if (kind === "auction") {
      assert.equal(v.auction.settings.maxRounds, 20);
      assert.equal(v.auction.settings.initialMoney, 2000);
      assert.equal(v.auction.settings.bidSeconds, 90);
    } else if (kind === "word-liar") {
      assert.equal(v.mbti.words.category, "animals");
      assert.equal(v.mbti.words.mode, "undercover-reveal");
    } else assert.equal(v.title, "수정된 자유 게임방");
  }
  ok(
    "auction money/deadline/rounds, liar category/mode and free-room metadata all edit and start correctly with existing ready players",
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
