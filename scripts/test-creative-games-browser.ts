import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { chromium } from "playwright";
import sharp from "sharp";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { profiles } from "../src/db/schema";
import { gameRooms, gameAssets } from "../src/db/game-room-schema";
import type { Database } from "../src/db/connection";
import { gameRoomService, type GamePrincipal } from "../src/server/game-room-service";
import { readGameRun } from "../src/server/game-run-service";
import { issueInkTicket } from "../src/server/game-ink-core";
import { createInkRedis } from "../src/server/game-ink-redis";
import { createInkGateway } from "../src/server/game-ink-gateway";
import { CLUE_PHOTO_BANK } from "../src/server/clue-bank";
const origin = new URL(process.env.SLIPER_GAME_QA_ORIGIN ?? "http://127.0.0.1:3107").origin;
const redisUrl = process.env.SLIPER_GAME_QA_REDIS ?? "redis://127.0.0.1:6380";
for (const value of [origin, redisUrl])
  assert.ok(
    ["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname),
    "Browser fixtures may only use local services",
  );
const output = path.join(process.cwd(), ".local");
await mkdir(output, { recursive: true });
const key = randomBytes(32).toString("hex"),
  pg = new PGlite(),
  db = drizzle(pg),
  connection = db as unknown as Database;
await pg.exec(
  "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
);
await migrate(db, { migrationsFolder: "./drizzle" });
const redis = await createInkRedis(redisUrl),
  gateway = await createInkGateway({ store: redis.store, key, origin });
gateway.server.listen(0, "127.0.0.1");
await once(gateway.server, "listening");
const address = gateway.server.address();
assert.ok(address && typeof address !== "string");
const service = gameRoomService(connection, { drawingAuthority: (a) => redis.sync(a) }),
  blob = new Map<string, Buffer>(),
  groups = new Map<string, { host: GamePrincipal; bots: GamePrincipal[] }>(),
  pending = new Map<string, Promise<void>>();
const principal = (actor: string | null = null): GamePrincipal => ({
  actor,
  identityHash: randomBytes(32).toString("hex"),
  networkHash: randomBytes(32).toString("hex"),
});
const sketch = await sharp(
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="white"/><path d="M80 300 L300 100 L580 400" stroke="#0A84FE" stroke-width="8" fill="none"/></svg>',
  ),
)
  .webp()
  .toBuffer();
async function bots(id: string) {
  const old = pending.get(id);
  if (old) return old;
  const work = (async () => {
    const group = groups.get(id);
    if (!group) return;
    for (const person of group.bots) {
      try {
        let v = await service.read(id, person),
          d = v.drawing;
        if (d && v.phase === "playing") {
          if ((d.stage === "prompt" || d.stage === "interpret") && !d.submitted)
            await service.player(id, person, {
              action: "drawing-text",
              runId: d.runId,
              phaseId: d.phaseId,
              text: d.stage === "prompt" ? "떡볶이를 먹는 펭귄" : "치킨을 든 오리",
            });
          else if (d.stage === "draw" && !d.submitted) {
            const assetId = randomUUID();
            blob.set(assetId, sketch);
            await db.insert(gameAssets).values({
              id: assetId,
              roomId: id,
              runId: d.runId,
              uploaderHash: person.identityHash,
              phaseId: d.phaseId,
              kind: "drawing",
              status: "ready",
              storageBackend: "local",
              objectKey: `${randomUUID()}.webp`,
              contentType: "image/webp",
              byteSize: sketch.length,
              expiresAt: new Date(v.expiresAt),
            });
            await service.player(id, person, {
              action: "drawing-image",
              runId: d.runId,
              phaseId: d.phaseId,
              assetId,
            });
          }
        }
        v = await service.read(id, person);
        if (
          v.clue &&
          v.phase === "lobby" &&
          v.clue.settings.mode === "member" &&
          !v.clue.myPrepared.length
        ) {
          const assetId = randomUUID();
          blob.set(assetId, sketch);
          await db.insert(gameAssets).values({
            id: assetId,
            roomId: id,
            uploaderHash: person.identityHash,
            kind: "photo",
            status: "ready",
            storageBackend: "local",
            objectKey: `${randomUUID()}.webp`,
            contentType: "image/webp",
            byteSize: sketch.length,
            expiresAt: new Date(v.expiresAt),
          });
          await service.player(id, person, {
            action: "clue-question",
            assetId,
            label: "테스트 장소",
            point: { latitude: 37.5, longitude: 127 },
            story: "브라우저 테스트 전용",
          });
        }
        v = await service.read(id, person);
        if (v.clue?.stage === "guess" && v.clue.canAnswer && !v.clue.myAnswer) {
          const [row] = await db.select().from(gameRooms).where(eq(gameRooms.id, id));
          const q = row!.clue!.deck[row!.clue!.index]!;
          await service.player(id, person, {
            action: "clue-answer",
            runId: v.clue.runId,
            phaseId: v.clue.phaseId,
            ...(v.clue.settings.mode === "quiz"
              ? { choice: q.correctChoice }
              : {
                  point: { latitude: 35, longitude: 128 },
                  ...(v.clue.settings.mode === "member" ? { authorId: q.authorId } : {}),
                }),
          });
        }
      } catch (e) {
        if ((e as { code?: string }).code !== "CONFLICT") throw e;
      }
    }
  })();
  pending.set(id, work);
  try {
    await work;
  } finally {
    pending.delete(id);
  }
}
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  errors: string[] = [],
  checks: unknown[] = [],
  failures: unknown[] = [];
try {
  for (const width of (process.env.QA_WIDTHS ?? "320,393,1440").split(",").map(Number)) {
    console.log("CHECK_WIDTH", width);
    const actor = randomUUID();
    await pg.query("insert into auth.users values($1)", [actor]);
    await db.insert(profiles).values({ id: actor, nickname: "화면 검증 호스트" });
    const context = await browser.newContext({
      viewport: { width, height: 920 },
      reducedMotion: process.env.QA_REDUCED ? "reduce" : "no-preference",
      isMobile: width < 721,
      hasTouch: width < 721,
      serviceWorkers: "block",
    });
    await context.addInitScript({
      content: `window.__name = (target) => target;
      window.__qaEvents=[];
      for(const name of ['click','submit','invalid'])document.addEventListener(name,e=>{const t=e.target;window.__qaEvents.push({event:name,tag:t.tagName,text:t.textContent?.slice(0,80),label:t.getAttribute('aria-label'),type:t.type});if(window.__qaEvents.length>20)window.__qaEvents.shift();},true);`,
    });
    await context.addInitScript(() => {
      const handlers = new Map<object, Map<string, Set<(event?: unknown) => void>>>();
      class LatLng {
        constructor(
          public latitude: number,
          public longitude: number,
        ) {}
        lat() {
          return this.latitude;
        }
        lng() {
          return this.longitude;
        }
      }
      class MapView {
        constructor(public element: HTMLElement) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = "테스트 지도에서 위치 선택";
          button.style.cssText =
            "position:absolute;top:40%;left:8%;padding:12px;background:#eff6ff;border:1px solid #0A84FE;border-radius:10px;z-index:3";
          button.onclick = () => {
            for (const fn of handlers.get(this)?.get("click") ?? [])
              fn({ coord: new LatLng(37.5, 127) });
          };
          element.appendChild(button);
        }
        getBounds() {
          return { getSW: () => new LatLng(33, 124), getNE: () => new LatLng(39, 132) };
        }
        panTo() {}
        setZoom() {}
        setOptions() {}
        autoResize() {}
        destroy() {
          this.element.innerHTML = "";
        }
      }
      class Marker {
        setMap() {}
        setOptions() {}
      }
      (window as unknown as { naver: unknown }).naver = {
        maps: {
          Map: MapView,
          LatLng,
          Marker,
          Polyline: class {
            setMap() {}
          },
          Position: { RIGHT_CENTER: 1 },
          Service: { Status: { OK: "OK" }, geocode() {} },
          Event: {
            addListener(target: object, name: string, fn: (event?: unknown) => void) {
              if (!handlers.has(target)) handlers.set(target, new Map());
              const events = handlers.get(target)!;
              if (!events.has(name)) events.set(name, new Set());
              events.get(name)!.add(fn);
              return { target, name, fn };
            },
            removeListener(h: { target: object; name: string; fn: (event?: unknown) => void }) {
              handlers.get(h.target)?.get(h.name)?.delete(h.fn);
            },
          },
        },
      };
    });
    await context.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        method = request.method();
      if (url.origin !== origin) {
        if (url.pathname.includes("maps.js"))
          return route.fulfill({ body: "", contentType: "application/javascript" });
        return route.abort();
      }
      const reply = (data: unknown) => route.fulfill({ json: { ok: true, data } });
      try {
        if (url.pathname === "/api/auth/session")
          return reply({
            available: true,
            authenticated: true,
            restricted: false,
            nickname: "화면 검증",
            mode: "supabase",
            role: null,
          });
        if (url.pathname === "/api/games" && method === "GET")
          return reply(await service.mine(actor));
        if (url.pathname === "/api/games" && method === "POST") {
          const payload = request.postDataJSON(),
            created = await service.create(actor, payload),
            host = principal(actor),
            group = {
              host,
              bots: Array.from({ length: payload.gameType === "drawing" ? 3 : 1 }, () =>
                principal(),
              ),
            };
          groups.set(created.id, group);
          for (const [i, p] of group.bots.entries()) {
            await service.connect(created.id, p);
            await service.player(created.id, p, { action: "nickname", nickname: `친구${i + 1}` });
            await service.player(created.id, p, { action: "ready", ready: true });
          }
          await bots(created.id);
          return reply(created);
        }
        const match = /^\/api\/games\/([a-f0-9-]+)(.*)$/.exec(url.pathname);
        if (match) {
          const id = match[1]!,
            tail = match[2]!,
            group = groups.get(id);
          if (!group) throw new Error("test room missing");
          const who = group.host;
          if (tail === "/stream") return route.abort();
          if (tail === "/connect") {
            await service.connect(id, who, !!request.postDataJSON().play);
            await bots(id);
            return reply(await service.read(id, who));
          }
          if (tail === "/ink") {
            const view = await service.read(id, who),
              authority = await redis.store.authority(id);
            assert.ok(authority);
            return reply({
              ticket: issueInkTicket(
                {
                  roomId: id,
                  phaseId: authority.phaseId,
                  member: view.viewer.id ?? "host",
                  expiresAt: Date.now() + 60000,
                },
                key,
              ),
              url: `ws://127.0.0.1:${address.port}/ws/games`,
            });
          }
          if (tail === "/media" && method === "POST") {
            const form = await new Request(origin + url.pathname, {
                method: "POST",
                headers: { "content-type": request.headers()["content-type"]! },
                body: new Uint8Array(request.postDataBuffer()!),
              }).formData(),
              file = form.get("file") as File,
              assetId = randomUUID(),
              view = await service.read(id, who),
              bytes = Buffer.from(await file.arrayBuffer());
            blob.set(assetId, bytes);
            await db.insert(gameAssets).values({
              id: assetId,
              roomId: id,
              runId: view.drawing?.runId ?? null,
              uploaderHash: who.identityHash,
              phaseId: form.get("phaseId") as string | null,
              kind: form.get("kind") as "drawing" | "photo",
              status: "ready",
              storageBackend: "local",
              objectKey: `${randomUUID()}.webp`,
              contentType: "image/webp",
              byteSize: bytes.length,
              expiresAt: new Date(view.expiresAt),
            });
            return reply({
              id: assetId,
              status: "ready",
              src: `/api/games/${id}/media/${assetId}?host=1`,
            });
          }
          if (tail.startsWith("/media/"))
            return route.fulfill({
              body: blob.get(tail.split("/")[2]!) ?? sketch,
              contentType: "image/webp",
            });
          if (tail.startsWith("/results/"))
            return reply(await readGameRun(connection, id, tail.split("/")[2]!, who));
          if (tail === "") {
            if (method === "PATCH") {
              const body = request.postDataJSON();
              if (url.searchParams.get("as") === "player") await service.player(id, who, body);
              else await service.host(id, who, body);
            }
            await bots(id);
            return reply(await service.read(id, who));
          }
        }
        if (url.pathname.startsWith("/api/"))
          return route.fulfill({
            status: 401,
            json: { ok: false, error: { code: "UNAUTHENTICATED", message: "UI fixture" } },
          });
        if (method !== "GET" && method !== "HEAD") return route.abort();
        return route.continue();
      } catch (error) {
        failures.push({
          path: url.pathname,
          action: method === "PATCH" ? request.postDataJSON().action : method,
          message: error instanceof Error ? error.message : "Fixture failure",
        });
        return route.fulfill({
          status: 400,
          json: {
            ok: false,
            error: {
              code: (error as { code?: string }).code ?? "TEST_ERROR",
              message: error instanceof Error ? error.message : "Fixture failure",
            },
          },
        });
      }
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(18000);
    const button = (name: string) => page.getByRole("button", { name, exact: true });
    async function catalog(game: string) {
      await page.goto(origin + "/games", { waitUntil: "domcontentloaded" });
      if (game === "낙서톡") {
        await page.screenshot({
          path: path.join(output, `creative-${width}-catalog.png`),
          fullPage: true,
        });
        if (width < 721) {
          const save = page.getByRole("button", { name: "낙서톡 찜하기", exact: true });
          const rect = await save.boundingBox();
          assert.ok(
            rect && rect.width >= 48 && rect.height >= 48,
            "touch save target must remain at least 48px",
          );
        }
      }
      await button(game + " 선택").click();
      await button("게임방 만들기").waitFor();
      assert.equal(
        await page.getByRole("heading", { name: /^함께할 게임 찾기/ }).count(),
        0,
        "inactive catalog is outside the accessibility tree",
      );
      if (game === "낙서톡")
        await page.screenshot({
          path: path.join(output, `creative-${width}-setup.png`),
          fullPage: true,
        });
    }
    async function enter() {
      await button("게임방 만들기").click();
      await page.waitForURL(/\/games\/[a-f0-9-]+\?host=1/);
      await button("플레이어로 참가").click();
      await page.getByLabel("게임 닉네임", { exact: true }).fill("나도 플레이");
      const saved = page.waitForResponse(
        (r) =>
          r.url().includes("/api/games/") &&
          r.request().method() === "PATCH" &&
          r.request().postDataJSON()?.action === "nickname",
      );
      await button("닉네임 저장").click();
      const nv = await (await saved).json();
      assert.equal(nv.data.viewer.nickname, "나도 플레이");
      await button("준비 완료").click();
    }
    async function noOverflow(label: string) {
      const v = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      assert.ok(v.scroll <= v.width + 1, label + ": " + JSON.stringify(v));
    }
    try {
      if (!process.env.QA_MEMBER_ONLY) {
        await catalog("낙서톡");
        for (const mode of ["live", "relay", "mix"]) {
          await page.locator(`label[data-mode="${mode}"]`).click();
          await noOverflow("drawing setup " + mode);
        }
        await page.getByRole("radio", { name: /^믹스 릴레이/ }).focus();
        await page.keyboard.press("ArrowRight");
        assert.equal(await page.getByRole("radio", { name: /^라이브 드로잉/ }).isChecked(), true);
        await page.locator('label[data-mode="mix"]').click();
        await enter();
        await button("게임 시작").click();
        await page.getByLabel("내 시작 문장", { exact: true }).fill("아이스크림을 먹는 로봇");
        await button("문장 전달하기").click();
        const canvas = page.locator("canvas[data-editable=true]");
        await canvas.waitFor();
        await canvas.scrollIntoViewIfNeeded();
        const box = await canvas.boundingBox();
        assert.ok(box);
        if (width < 721) {
          const cdp = await context.newCDPSession(page);
          const start = { x: box.x + box.width * 0.2, y: box.y + box.height * 0.3 };
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
          for (let i = 1; i <= 10; i++)
            await cdp.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [
                { x: start.x + box.width * 0.04 * i, y: start.y + box.height * 0.025 * i },
              ],
            });
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await cdp.detach();
        } else {
          await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 12 });
          await page.mouse.up();
        }
        await page.waitForTimeout(500);
        await noOverflow("drawing play");
        const roomId = /\/games\/([a-f0-9-]+)/.exec(new URL(page.url()).pathname)![1]!,
          authority = await redis.store.authority(roomId),
          member = await service.read(roomId, groups.get(roomId)!.host);
        assert.ok(authority?.members[member.viewer.id!]?.write);
        assert.ok(
          (await redis.store.events(roomId, authority.members[member.viewer.id!]!.write!)).length >
            0,
          "actual pointer events reached Redis",
        );
        await page.screenshot({
          path: path.join(output, `creative-${width}-drawing.png`),
          fullPage: true,
        });
        await button("그림 완성 · 다음 사람에게 전달").click();
        await page.getByLabel("그림을 보고 떠오르는 문장", { exact: true }).fill("치킨을 든 오리");
        await button("문장 전달하기").click();
        await page.getByRole("heading", { name: "실시간 그림 맞히기", exact: true }).waitFor();
        console.log("DRAWING_OK", width);
        checks.push({
          width,
          game: "drawing",
          input: width < 721 ? "touch" : "mouse",
          realRedis: true,
          nativeRadioKeyboard: true,
        });
        await catalog("단서각");
        for (const mode of ["zoom", "quiz", "member", "photo"]) {
          await page.locator(`label[data-mode="${mode}"]`).click();
          await noOverflow("clue setup " + mode);
        }
        await page.getByLabel("문제 수", { exact: true }).selectOption("20");
        await page.locator('label[data-mode="quiz"]').click();
        assert.equal(await page.getByLabel("문제 수", { exact: true }).inputValue(), "10");
        assert.equal(
          await page.getByLabel("문제 수", { exact: true }).locator('option[value="20"]').count(),
          0,
        );
        await page.locator('label[data-mode="photo"]').click();
        await page.getByLabel("문제 수", { exact: true }).selectOption("1");
        await enter();
        await button("게임 시작").click();
        await button("테스트 지도에서 위치 선택").click();
        await button("이 위치로 제출").click();
        await page.getByRole("heading", { name: /^정답 ·/ }).waitFor();
        await noOverflow("clue result");
        await page.screenshot({
          path: path.join(output, `creative-${width}-clue.png`),
          fullPage: true,
        });
        await button("다음 단계").click();
        const archiveLink = page.getByRole("link", {
          name: "이 게임 결과 다시 보기 · 24시간 보관",
        });
        const target = await archiveLink.getAttribute("href");
        assert.ok(target);
        await archiveLink.scrollIntoViewIfNeeded();
        await archiveLink.click();
        try {
          await page.waitForURL("**" + target, { timeout: 10000 });
        } catch (e) {
          console.log(
            "ARCHIVE_CLICK_DIAGNOSTIC",
            JSON.stringify({
              href: target,
              url: page.url(),
              active: await page.evaluate(() => ({
                tag: document.activeElement?.tagName,
                html: document.activeElement?.outerHTML?.slice(0, 1000),
              })),
            }),
          );
          throw e;
        }
        await page
          .getByText("함께한 참가자만 같은 브라우저의 참가 연결로 볼 수 있어요.", { exact: false })
          .waitFor();
        await noOverflow("archived result");
        console.log("CLUE_OK", width);
        checks.push({
          width,
          game: "clue",
          map: "SDK stub; click adapter tested",
          submitAndArchive: true,
        });
      }
      if (width === 393) {
        await catalog("단서각");
        await page.locator('label[data-mode="member"]').click();
        await enter();
        assert.equal(await button("게임 시작").isDisabled(), true);
        await page
          .getByLabel("사진 10MB 이하", { exact: true })
          .setInputFiles(path.join(process.cwd(), "public", CLUE_PHOTO_BANK[0]!.basicAsset!));
        await page.getByLabel("정답 장소 이름", { exact: true }).fill("내 사진 속 장소");
        await button("테스트 지도에서 위치 선택").click();
        await button("내 사진·정답 등록").click();
        await page.getByText("등록 완료", { exact: true }).waitFor();
        assert.equal(await button("게임 시작").isEnabled(), true);
        await noOverflow("member photo prep");
        checks.push({ width, game: "member-photo", uploadAndReadyGate: true });
      }
    } catch (e) {
      await page.screenshot({
        path: path.join(output, "creative-games-browser-failure.png"),
        fullPage: true,
      });
      console.log(
        "BROWSER_FAILURE",
        JSON.stringify({
          width,
          errors,
          failures,
          events: await page.evaluate(
            () => (window as unknown as { __qaEvents: unknown[] }).__qaEvents,
          ),
          formState: await page.evaluate(() =>
            Array.from(document.querySelectorAll("form")).map((f) => ({
              name: f.getAttribute("aria-label"),
              valid: f.checkValidity(),
              fields: Array.from(f.querySelectorAll("input")).map((i) => ({
                label: i.getAttribute("aria-label"),
                value: i.type === "password" ? "" : i.value,
                valid: i.validity.valid,
              })),
              buttons: Array.from(f.querySelectorAll("button")).map((b) => ({
                text: b.textContent,
                disabled: b.disabled,
              })),
            })),
          ),
          overflow: await page.evaluate(() =>
            Array.from(document.querySelectorAll("*"))
              .map((el) => ({
                tag: el.tagName,
                cls: el.className,
                rect: el.getBoundingClientRect().toJSON(),
              }))
              .filter((el) => el.rect.right > innerWidth + 1)
              .slice(0, 25),
          ),
          body: (await page.locator("body").innerText()).slice(-2800),
        }),
      );
      throw e;
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  await writeFile(
    path.join(output, "creative-games-browser-qa.json"),
    JSON.stringify({ checks, pageErrors: errors, productionDatabaseTouched: false }, null, 2),
  );
  console.log(JSON.stringify({ checks, pageErrors: errors, productionDatabaseTouched: false }));
} finally {
  await browser.close();
  await gateway.close();
  await redis.close();
  await pg.close();
}
