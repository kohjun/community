import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { inArray, sql } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import { profiles } from "../src/db/schema";
import {
  libraryEntries,
  libraryAccessRequests,
  libraryPurchases,
  libraryPurchaseAudit,
  libraryPurchaseDisputes,
  libraryWebhookReceipts,
} from "../src/db/library-schema";
import { libraryService } from "../src/server/library-service";
import { libraryMarketService } from "../src/server/library-market-service";
import { libraryInputSchema } from "../src/domain/library";
import type { PurchaseDetail } from "../src/domain/library-market";
import type { ActionResult } from "../src/domain/contracts";
import {
  loadLocalTestAccount,
  createLocalTestSession,
  createLocalTestGuestSession,
} from "../src/server/local-test-auth";
const origin = "http://127.0.0.1:3000",
  url = new URL(process.env.DATABASE_URL ?? "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  process.env.APP_ORIGIN !== origin ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "55432" ||
  url.pathname !== "/sliper_dev"
)
  throw Error("Prepared isolated local DB and origin required");
const account = loadLocalTestAccount({ ...process.env, NODE_ENV: "development" });
if (!account) throw Error("Prepared local test login required");
const actor = account.userId,
  cookie = "sliper_test_session=" + createLocalTestSession(account, new URL(origin).host),
  guest = "sliper_test_session=" + createLocalTestGuestSession(account, new URL(origin).host);
async function raw<T>(
  path: string,
  method = "GET",
  body?: unknown,
  session = cookie,
  from = origin,
) {
  const r = await fetch(origin + path, {
    method,
    headers: {
      Cookie: session,
      Origin: from,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60000),
  });
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  return { status: r.status, result: (await r.json()) as ActionResult<T> };
}
function data<T>(r: Awaited<ReturnType<typeof raw<T>>>) {
  assert.equal(r.status, 200);
  if (!r.result.ok) throw Error(r.result.error.message);
  return r.result.data;
}
const content = libraryInputSchema.parse({
  kind: "template",
  categorySlug: "mind-games",
  title: "http-market-" + randomUUID(),
  summary: "회원 구매와 판매 페이지의 권한 경계를 확인하는 검증용 운영 자료입니다.",
  scenario: "PRIVATE-HTTP-MARKET 참가자들이 역할을 정하고 단서를 모아 게임을 진행합니다.",
  rules: "참가자 모두에게 동일한 시간을 제공하고 단서를 순서대로 공개합니다.",
  hostGuide: "진행자는 매 라운드의 규칙을 다시 안내하고 시간이 끝나면 토론을 정리합니다.",
  materials: [],
  rounds: [{ name: "라운드", seconds: 300 }],
  tags: [],
  minPlayers: 2,
  maxPlayers: 10,
  durationMinutes: 60,
  priceKRW: 1000,
  purchaseUrl: "https://example.invalid/buy",
  usageTerms: "개인 모임에 사용하는 자료 이용 조건입니다.",
});
test("HTTP market: exact purchase consent, private receipts, seller approval, disputes and refund access recovery", async () => {
  const connection = createDatabase(url.toString(), 1),
    db = connection.db,
    library = libraryService(db),
    market = libraryMarketService(db),
    entries: string[] = [];
  let peer = "";
  try {
    peer = randomUUID();
    await db.execute(sql`insert into auth.users(id) values(${peer}::uuid)`);
    await db.insert(profiles).values({ id: peer, nickname: "HTTP 시장 임시 판매자" });
    const source = await library.create(peer, content);
    entries.push(source.id);
    const request = {
      version: 1,
      externalReference: "HTTP-ORDER-" + randomUUID(),
      note: "PRIVATE-HTTP-NOTE",
      consent: true,
    };
    assert.equal(
      (await raw("/api/library/" + source.id + "/purchase", "POST", request, guest)).status,
      401,
    );
    assert.equal(
      (
        await raw(
          "/api/library/" + source.id + "/purchase",
          "POST",
          request,
          cookie,
          "https://foreign.invalid",
        )
      ).status,
      403,
    );
    assert.equal(
      (await raw("/api/library/" + source.id + "/purchase", "POST", { ...request, amountKRW: 1 }))
        .status,
      400,
    );
    const p = data(
      await raw<PurchaseDetail>("/api/library/" + source.id + "/purchase", "POST", request),
    );
    assert.equal(p.snapshot.versionNumber, 1);
    assert.equal(JSON.stringify(p).includes("PRIVATE-HTTP-MARKET"), false);
    assert.equal((await raw("/api/library-market/" + p.id, "GET", undefined, guest)).status, 401);
    assert.equal(
      (await raw("/api/library-market?scope=disputes")).status,
      (await market.list(actor)).canReviewDisputes ? 200 : 403,
    );
    assert.equal((await raw("/api/library-market?scope=buying&scope=selling")).status, 400);
    assert.equal(
      (
        await raw("/api/library-market/" + p.id + "/decision", "POST", {
          action: "approve",
          expectedUpdatedAt: p.updatedAt,
          paymentChecked: true,
          note: "구매자 자체 승인 시도",
        })
      ).status,
      403,
    );
    await market.decide(peer, p.id, {
      action: "approve",
      expectedUpdatedAt: p.updatedAt,
      paymentChecked: true,
      note: "외부 결제 확인",
    });
    const approved = data(await raw<PurchaseDetail>("/api/library-market/" + p.id));
    assert.equal(approved.status, "paid");
    assert.ok((await library.detail(actor, source.id)).payload);
    const opened = data(
        await raw<PurchaseDetail>("/api/library-market/" + p.id + "/disputes", "POST", {
          kind: "payment",
          body: "외부 결제 처리와 환불 여부를 확인하고 싶습니다.",
        }),
      ),
      d = opened.disputes[0]!;
    assert.equal(
      (
        await raw("/api/library-market/" + p.id + "/disputes/" + d.id + "/resolve", "POST", {
          expectedUpdatedAt: d.updatedAt,
          outcome: "refund_confirmed",
          note: "구매자가 직접 환불 승인 시도",
          paymentChecked: true,
        })
      ).status,
      403,
    );
    const withdrawn = data(
      await raw<PurchaseDetail>(
        "/api/library-market/" + p.id + "/disputes/" + d.id + "/withdraw",
        "POST",
        { expectedUpdatedAt: d.updatedAt },
      ),
    );
    assert.equal(withdrawn.disputes[0]!.status, "withdrawn");
    const own = await library.create(actor, {
      ...content,
      title: "http-market-sale-" + randomUUID(),
    });
    entries.push(own.id);
    const other = await market.request(peer, own.id, {
      version: 1,
      externalReference: "HTTP-SELL-" + randomUUID(),
      consent: true,
    });
    const paid = data(
      await raw<PurchaseDetail>("/api/library-market/" + other.id + "/decision", "POST", {
        action: "approve",
        expectedUpdatedAt: other.updatedAt,
        note: "판매자 결제 확인",
        paymentChecked: true,
      }),
    );
    const refunded = data(
      await raw<PurchaseDetail>("/api/library-market/" + other.id + "/decision", "POST", {
        action: "refund",
        expectedUpdatedAt: paid.updatedAt,
        note: "외부 전액 환불 처리 완료 확인",
        paymentChecked: true,
      }),
    );
    assert.equal(refunded.status, "refunded");
    assert.equal((await library.detail(peer, own.id)).payload, null);
    for (const path of [
      "/archive/purchases",
      "/archive/purchases/" + p.id,
      "/archive/purchases?scope=selling",
    ]) {
      const r = await fetch(origin + path, {
        headers: { Cookie: cookie },
        signal: AbortSignal.timeout(60000),
      });
      assert.equal(r.status, 200);
      const body = await r.text();
      assert.equal(body.includes("PRIVATE-HTTP-MARKET"), false);
      assert.ok(body.includes("구매"));
    }
    const noLogin = await fetch(origin + "/archive/purchases/" + p.id, {
      headers: { Cookie: guest },
      redirect: "manual",
    });
    assert.equal(noLogin.status, 307);
    const evidence = data(
      await raw<{ total: number }>("/api/library/" + source.id + "/evidence?page=1"),
    );
    assert.equal(evidence.total, 0);
    assert.equal(
      (await raw("/api/library/" + source.id + "/evidence", "GET", undefined, guest)).status,
      401,
    );
    const demo = await library.create(peer, {
      ...content,
      title: "HTTP 테스트 구매-" + randomUUID(),
    });
    entries.push(demo.id);
    const demoPath = "/api/library/" + demo.id + "/test-purchase";
    const demoRequest = { version: 1, note: "테스트 구매 검증", consent: true };
    assert.equal((await raw(demoPath, "POST", demoRequest, guest)).status, 401);
    assert.equal(
      (await raw(demoPath, "POST", demoRequest, cookie, "https://foreign.invalid")).status,
      403,
    );
    assert.equal((await raw(demoPath, "POST", { ...demoRequest, amountKRW: 1 })).status, 400);
    assert.equal((await raw(demoPath, "POST", { ...demoRequest, version: 2 })).status, 409);
    const beforeDemo = await fetch(origin + "/archive/" + demo.id, { headers: { Cookie: cookie } });
    const beforeHtml = await beforeDemo.text();
    assert.equal(beforeDemo.status, 200);
    assert.ok(beforeHtml.includes("테스트 구매하고 열람하기"));
    assert.equal(beforeHtml.includes('name="externalReference"'), false);
    assert.equal(beforeHtml.includes("PRIVATE-HTTP-MARKET"), false);
    const completed = await Promise.all([
      raw<PurchaseDetail>(demoPath, "POST", demoRequest),
      raw<PurchaseDetail>(demoPath, "POST", demoRequest),
    ]);
    const one = data(completed[0]!);
    assert.equal(data(completed[1]!).id, one.id);
    assert.equal(one.status, "paid");
    assert.equal(one.provider, "local-test");
    assert.equal(one.amountKRW, content.priceKRW);
    assert.ok(one.audit.some((item) => item.note.includes("실제 결제 없이")));
    assert.ok((await library.detail(actor, demo.id)).payload);
    const demoReceipt = await fetch(origin + "/archive/purchases/" + one.id, {
      headers: { Cookie: cookie },
    });
    assert.ok((await demoReceipt.text()).includes("실제 결제나 금액 청구는 발생하지 않았어요"));
    const reopened = await fetch(origin + "/archive/" + demo.id, { headers: { Cookie: cookie } });
    assert.ok((await reopened.text()).includes("PRIVATE-HTTP-MARKET"));
    const head = await fetch(origin + "/api/library-market/" + p.id, {
      method: "HEAD",
      headers: { Cookie: cookie },
    });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  } finally {
    try {
      if (entries.length) {
        const ids = (
          await db
            .select({ id: libraryPurchases.id })
            .from(libraryPurchases)
            .where(inArray(libraryPurchases.entryId, entries))
        ).map((p) => p.id);
        if (ids.length) {
          await db
            .delete(libraryPurchaseDisputes)
            .where(inArray(libraryPurchaseDisputes.purchaseId, ids));
          await db
            .delete(libraryWebhookReceipts)
            .where(inArray(libraryWebhookReceipts.purchaseId, ids));
          await db
            .delete(libraryPurchaseAudit)
            .where(inArray(libraryPurchaseAudit.purchaseId, ids));
          await db.delete(libraryPurchases).where(inArray(libraryPurchases.id, ids));
        }
        await db
          .delete(libraryAccessRequests)
          .where(inArray(libraryAccessRequests.entryId, entries));
        await db.delete(libraryEntries).where(inArray(libraryEntries.id, entries));
      }
      if (peer) await db.execute(sql`delete from auth.users where id=${peer}::uuid`);
    } finally {
      await connection.close();
    }
  }
});
