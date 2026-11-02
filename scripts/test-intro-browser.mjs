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
const artifact = process.env.SLIPER_GAME_BROWSER_OUTPUT ?? ".local/intro-browser";
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
 await hp.getByRole("button", { name: "MBTI 자기소개 게임 선택", exact: true }).click();await hp.getByLabel("참가 정원").selectOption("4");await hp.getByLabel("진행 라운드 수",{exact:true}).selectOption("2");
 await hp.screenshot({path:artifact+"/create.png",fullPage:true});await hp.getByRole("button",{name:"게임방 만들기",exact:true}).click();await hp.waitForURL(/games\/[a-f0-9-]+\?host=1/);
 const roomId=new URL(hp.url()).pathname.split("/")[2],participants=[],words=['ENFP','ISTJ','ENTP','ISFJ'];
 for(let i=0;i<4;i++){const c=await browser.newContext({viewport:{width:393,height:950},isMobile:true,hasTouch:true,serviceWorkers:"block"});const p=await c.newPage();p.on("pageerror",e=>browserErrors.push(e.message));p.on("dialog",d=>d.accept());await p.goto(origin+"/games/"+roomId);await p.getByLabel("게임 닉네임").fill("배우"+(i+1));await p.getByLabel("내 MBTI",{exact:true}).selectOption(words[i]);await p.getByRole("button",{name:"소개 정보 저장",exact:true}).click();await p.getByRole("button",{name:"준비 완료",exact:true}).click();participants.push(p);}
 await hp.getByRole("button",{name:"게임 시작",exact:true}).click();await hp.getByRole("heading",{name:"이 상황에서 나는 이렇게 해요",exact:true}).waitFor();
 ok("host sets two rounds and four guests register their MBTI and readiness");
 const first=participants[0];for(let j=1;j<4;j++)await first.getByLabel(`배우${j+1} MBTI 추리`,{exact:true}).selectOption(j===3?'INFJ':words[j]);
 assert.equal(await first.getByRole('button',{name:'설명이 끝나면 제출할 수 있어요',exact:true}).isDisabled(),true);
 await first.screenshot({path:artifact+'/draft-during-explanations.png',fullPage:true});await hp.screenshot({path:artifact+'/acting-host.png',fullPage:true});
 for(let i=0;i<4;i++){await participants[i].getByRole('button',{name:'설명 완료',exact:true}).click();}
 const submit=first.getByRole('button',{name:'이번 라운드 추리 제출',exact:true});await submit.waitFor();assert.equal(await first.getByLabel('배우4 MBTI 추리',{exact:true}).inputValue(),'INFJ');
 ok("drafts are editable during speaking, submission waits for everyone, and choices survive the phase transition");
 await submit.click();await first.getByText('2명 O',{exact:true}).waitFor();await first.getByText('1명 X',{exact:true}).waitFor();await first.screenshot({path:artifact+'/feedback-mobile.png',fullPage:true});
 for(let i=1;i<4;i++){for(let j=0;j<4;j++)if(j!==i)await participants[i].getByLabel(`배우${j+1} MBTI 추리`,{exact:true}).selectOption('INFJ');await participants[i].getByRole('button',{name:'이번 라운드 추리 제출',exact:true}).click();}
 await hp.getByRole('heading',{name:'이번 라운드를 확인해요',exact:true}).waitFor();assert.equal(await hp.getByText('ENFP',{exact:true}).count(),0);await hp.getByRole('button',{name:'다음 라운드 시작',exact:true}).click();
 await first.getByRole('button',{name:'설명 완료',exact:true}).waitFor();assert.equal(await first.getByLabel('배우4 MBTI 추리',{exact:true}).inputValue(),'INFJ');
 ok("counts-only feedback and round review keep individual answers private; host opens a new full speaking round");
 for(let i=0;i<4;i++)await participants[i].getByRole('button',{name:'설명 완료',exact:true}).click();
 for(let j=1;j<4;j++)await first.getByLabel(`배우${j+1} MBTI 추리`,{exact:true}).selectOption(words[j]);
 await first.getByRole('button',{name:'이번 라운드 추리 제출',exact:true}).click();await hp.getByRole('heading',{name:'배우1 님이 모두 맞혔어요!',exact:true}).waitFor();
 for(const p of participants){for(const word of words)await p.getByText(word,{exact:true}).waitFor();}
 for(const width of [320,393,1440]){await first.setViewportSize({width,height:950});assert.equal(await first.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await first.screenshot({path:artifact+`/result-${width}.png`,fullPage:true});}
 ok("first perfect submission immediately ends the game, reveals all MBTIs to participants and fits mobile and desktop");
 assert.deepEqual(browserErrors,[]);await writeFile(artifact+'/report.json',JSON.stringify({status:'passed',checks,browserErrors,productionTouched:false},null,2));console.log(JSON.stringify({status:'passed',checks:checks.length}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await pg.close();}
