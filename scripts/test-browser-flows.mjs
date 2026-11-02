import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
const inert = {
  "participation-shell":
    "export function ParticipationShell({children}){return <main>{children}</main>}",
  "event-private-contact": "export function EventPrivateContact(){return null}",
  "admission-ticket": "export function AdmissionTicket(){return null}",
  "record-discovery": "export function RecordBacklink(){return null}",
  "verified-event-reviews": "export function VerifiedEventReviews(){return null}",
  "refund-panel": "export function RefundPanel(){return null}",
  "event-lifecycle-panel": "export function EventLifecyclePanel(){return null}",
  "event-location-field": "export function EventLocationField(){return null}",
  "rich-post-editor": `import React,{forwardRef,useEffect,useImperativeHandle} from 'react';
    export const RichPostEditor=forwardRef(function Editor(props,ref){
      const doc=text=>({version:1,type:'doc',content:[{type:'paragraph',content:text?[{type:'text',text}]:[]}]});
      useImperativeHandle(ref,()=>({insertTemplate:text=>props.onChange(doc(text),props.images,props.videos)}));
      useEffect(()=>{props.onChange(doc(props.body),props.images,props.videos)},[]);
      return <textarea aria-label="검증 본문" defaultValue={props.body} onChange={e=>props.onChange(doc(e.target.value),props.images,props.videos)}/>;
    });`,
};
const bundle = await build({
  entryPoints: ["tests/browser/priority-fixture.tsx"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"test"' },
  plugins: [
    {
      name: "irrelevant-fixture-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({
          path: args.path,
          namespace: "fixture",
        }));
        builder.onResolve({ filter: /^\.\// }, (args) => {
          const key = args.path.slice(2);
          if (inert[key]) return { path: key, namespace: "fixture" };
        });
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          loader: "tsx",
          resolveDir: process.cwd(),
          contents:
            args.path === "next/link"
              ? `export default function Link({href,children,...props}){return <a {...props} href={href}>{children}</a>}`
              : args.path === "next/navigation"
                ? `export function usePathname(){return location.pathname} export function useRouter(){return {push:href=>location.assign(href),refresh(){}}}`
                : inert[args.path],
        }));
      },
    },
  ],
});
const server = http.createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (request.url.startsWith("/fixture.js")) {
    response.setHeader("Content-Type", "text/javascript");
    response.end(bundle.outputFiles[0].text);
    return;
  }
  response.setHeader("Content-Type", "text/html;charset=utf-8");
  response.end(
    '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port,
  results = [];
const channel = process.env.SLIPER_BROWSER_CHANNEL ?? "chrome";
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } }),
      page = await context.newPage(),
      errors = [];
    let phase = "waiting";
    page.on("pageerror", (error) => errors.push(error.message));
    page.setDefaultTimeout(10000);
    const initial = {
      postId: "11111111-1111-4111-8111-111111111111",
      title: "브라우저 검증 번개",
      location: "테스트 장소",
      eventDate: null,
      externalUrl: null,
      isOwner: false,
      canManage: false,
      publicProfileId: null,
      canApply: true,
      applicantProfile: { nickname: "검증회원", phoneNumber: "01000000000", ready: true },
      application: null,
      config: {
        open: true,
        capacity: 1,
        occupied: 1,
        amountKRW: 0,
        approvalMode: "manual",
        startsAt: null,
        endsAt: null,
        refundPolicy: "sliper-v1",
        questions: [],
        questionnaireVersion: "",
        meetupType: "lightning",
      },
    };
    await context.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() !== "GET")
        throw Error("Unexpected mutation request in read-only browser fixture");
      if (path.includes("/growth/waitlist/")) {
        const offered = phase === "offered";
        await route.fulfill({
          json: {
            ok: true,
            data: {
              available: true,
              full: true,
              state: offered ? "offered" : "waiting",
              position: 1,
              offerUntil: offered ? new Date(Date.now() + 2500).toISOString() : null,
            },
          },
        });
        return;
      }
      if (path.startsWith("/api/participation/events/")) {
        await route.fulfill({
          json: {
            ok: true,
            data: {
              ...initial,
              config: { ...initial.config, occupied: phase === "offered" ? 0 : 1 },
            },
          },
        });
        return;
      }
      throw Error("Unexpected fixture API path: " + path);
    });
    await page.goto(origin + "/?scenario=waitlist");
    await page.getByText(/내 대기 순서/).waitFor();
    const submit = page.getByRole("button", { name: "참가 요청 보내기", exact: true });
    assert.equal(await submit.count(), 0);
    phase = "offered";
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await submit.waitFor();
    await submit.waitFor({ state: "hidden", timeout: 6500 });
    results.push({ width, scenario: "waitlist-offer-and-expiry", passed: true });
    await page.goto(origin + "/players?scenario=login&tab=crews#intro");
    const link = page.getByRole("link", { name: "로그인 후 계속" });
    await page.waitForFunction(() =>
      document.querySelector("a")?.href.includes("returnTo=%2Fplayers"),
    );
    const href = await link.getAttribute("href");
    assert.equal(
      new URL(href, origin).searchParams.get("returnTo"),
      "/players?scenario=login&tab=crews#intro",
    );
    results.push({ width, scenario: "login-destination", passed: true });
    let discard = false,
      confirmations = 0;
    page.on("dialog", async (dialog) => {
      confirmations++;
      if (discard) await dialog.accept();
      else await dialog.dismiss();
    });
    await page.goto(origin + "/?scenario=draft");
    await page.getByRole("button", { name: "글쓰기 열기" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const title = dialog.getByRole("textbox", { name: /제목/ });
    await title.fill("사라지면 안 되는 초안");
    await page.keyboard.press("Escape");
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await title.inputValue(), "사라지면 안 되는 초안");
    discard = true;
    await dialog.getByRole("button", { name: "닫기", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(confirmations, 2);
    await page.getByRole("button", { name: "글쓰기 열기" }).click();
    assert.equal(
      await page.getByRole("dialog").getByRole("textbox", { name: /제목/ }).inputValue(),
      "",
    );
    results.push({ width, scenario: "dirty-close-cancel-and-discard", passed: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  await mkdir(".local", { recursive: true });
  await writeFile(
    ".local/priority-browser-results.json",
    JSON.stringify({ scope: "isolated-real-components", dataWrites: 0, results }, null, 2),
  );
  console.log(JSON.stringify({ scenarios: results.length, passed: results.length, dataWrites: 0 }));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
