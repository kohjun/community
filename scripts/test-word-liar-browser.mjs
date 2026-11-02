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
const artifact = process.env.SLIPER_GAME_BROWSER_OUTPUT ?? ".local/word-browser";
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
let gameClock=Date.now();
const service = gameRoomService(db, { now:()=>new Date(gameClock), wake: (id) => bus.publish(id) });
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
 browser=await chromium.launch({channel:"chrome",headless:true});
 const hc=await browser.newContext({viewport:{width:1440,height:1050},serviceWorkers:"block"});await hc.addCookies([{name:"game-test-host",value:hostCookie,url:origin}]);
 const hp=await hc.newPage();hp.on("pageerror",e=>browserErrors.push(e.message));hp.on("dialog",d=>d.accept());await hp.goto(origin+"/games");
 await hp.getByRole("button", { name: "제시어 라이어 게임 선택", exact: true }).click();await hp.getByLabel("제시어 카테고리",{exact:true}).selectOption("animals");await hp.getByLabel("라이어 방식",{exact:true}).selectOption("classic");await hp.getByLabel("참가 정원").selectOption("3");
 await hp.screenshot({path:artifact+"/create.png",fullPage:true});await hp.getByRole("button",{name:"게임방 만들기",exact:true}).click();await hp.waitForURL(/games\/[a-f0-9-]+\?host=1/);
 const roomId=new URL(hp.url()).pathname.split("/")[2];const participants=[];
 for(let i=0;i<3;i++){const c=await browser.newContext({viewport:{width:393,height:950},isMobile:true,hasTouch:true,serviceWorkers:"block"});const p=await c.newPage();p.on("pageerror",e=>browserErrors.push(e.message));p.on("dialog",d=>d.accept());await p.goto(origin+"/games/"+roomId);await p.getByLabel("게임 닉네임").fill("단어배우"+(i+1));assert.equal(await p.getByLabel('내 MBTI',{exact:true}).count(),0);await p.getByRole("button",{name:"닉네임 저장",exact:true}).click();await p.getByRole("button",{name:"준비 완료",exact:true}).click();participants.push(p);}
 await hp.getByRole("button",{name:"게임 시작",exact:true}).click();await hp.getByRole("heading",{name:"제시어를 자연스럽게 설명해요",exact:true}).waitFor();
 const {gameRooms}=await import('../src/db/game-room-schema.ts');const {eq}=await import('drizzle-orm');const [raw]=await db.select().from(gameRooms).where(eq(gameRooms.id,roomId));const state=raw.mbti,liarIndex=state.roster.findIndex(p=>p.id===state.liar),liarName=state.roster[liarIndex].nickname;
 for(let i=0;i<3;i++){const p=participants[i];await p.getByRole('button',{name:'제시어 확인',exact:true}).click();await p.getByRole('heading',{name:i===liarIndex?'라이어':state.common,exact:true}).waitFor();}
 assert.equal(await hp.getByText(state.common,{exact:true}).count(),0);assert.ok(!js.includes('비행기조종사'));ok('category selection assigns a common animal word while only one guest sees the liar role; host and client bundle contain no answer pool');
 await hp.screenshot({path:artifact+'/acting-host.png',fullPage:true});await participants[liarIndex].screenshot({path:artifact+'/liar-mobile.png',fullPage:true});
 for(let i=0;i<3;i++){gameClock+=30000;await service.read(roomId,{actor:owner,identityHash:'a'.repeat(64),networkHash:'b'.repeat(64)});await bus.publish(roomId);}
 await hp.getByText('비공개 투표',{exact:true}).waitFor();
 for(let i=0;i<3;i++){const p=participants[i];if(i===liarIndex)await p.getByRole('button',{name:'기권하기',exact:true}).click();else{await p.getByRole('button',{name:liarName,exact:true}).click();await p.getByRole('button',{name:'선택한 사람에게 투표',exact:true}).click();}}
 await hp.getByRole('heading',{name:'라이어의 마지막 추리',exact:true}).waitFor();assert.equal(await hp.getByText(state.common,{exact:true}).count(),0);ok('timed descriptions and majority vote reveal the liar without disclosing the common word');
 const liar=participants[liarIndex];await liar.getByLabel('공통 제시어 정답',{exact:true}).fill(state.common.split('').join(' '));await liar.getByRole('button',{name:'마지막 추리 제출',exact:true}).click();await hp.getByRole('heading',{name:'라이어 승리!',exact:true}).waitFor();ok('liar enters a free-text final answer and spacing-normalized correct guesses win');
 for(const width of [320,393,1440]){await liar.setViewportSize({width,height:950});assert.equal(await liar.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await liar.screenshot({path:artifact+`/result-${width}.png`,fullPage:true});}
 assert.deepEqual(browserErrors,[]);ok('mobile and desktop results have no horizontal overflow or browser errors');await writeFile(artifact+'/report.json',JSON.stringify({status:'passed',checks,browserErrors,productionTouched:false},null,2));console.log(JSON.stringify({status:'passed',checks:checks.length}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await pg.close();}
