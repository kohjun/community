import "dotenv/config";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { createDatabase, type Database } from "../src/db/connection";
import { profiles } from "../src/db/schema";
import { staffRoles } from "../src/db/safety-schema";
import {
  libraryEntries,
  libraryPurchases,
  libraryPurchaseAudit,
  libraryPurchaseDisputes,
  libraryWebhookReceipts,
  libraryAccessRequests,
} from "../src/db/library-schema";
import { libraryService } from "../src/server/library-service";
import { libraryMarketService } from "../src/server/library-market-service";
import { POST } from "../src/app/api/payments/library-webhook/route";
import { libraryInputSchema } from "../src/domain/library";
import type { PurchaseDetail } from "../src/domain/library-market";
import { AppError } from "../src/server/errors";
const url = new URL(process.env.DATABASE_URL ?? "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "55432" ||
  url.pathname !== "/sliper_dev"
)
  throw Error("Isolated local PostgreSQL required");
const content = libraryInputSchema.parse({
  kind: "template",
  categorySlug: "mind-games",
  title: "native-market-" + randomUUID(),
  summary: "구매 기록과 버전 및 실제 독립 연결에서 권한 처리를 확인하는 운영 자료입니다.",
  scenario: "PRIVATE-NATIVE-MARKET 참가자가 역할을 정하고 단서를 모아 협력하는 게임을 진행합니다.",
  rules: "참가자는 서로 역할 카드를 공개하지 않고 라운드마다 단서를 하나씩 공유합니다.",
  hostGuide: "진행자는 모든 참가자에게 같은 시간을 안내하고 마지막에 정답을 공개합니다.",
  materials: ["역할 카드"],
  rounds: [{ name: "추리", seconds: 300 }],
  tags: ["검증"],
  minPlayers: 2,
  maxPlayers: 10,
  durationMinutes: 60,
  priceKRW: 1000,
  purchaseUrl: "https://example.invalid/library-buy",
  usageTerms: "구매자는 무료 모임에서만 이 자료를 이용합니다.",
  allowDerivatives: false,
  allowCommercialUse: false,
});
const code = (name: string) => (e: unknown) => e instanceof AppError && e.code === name;
async function member(db: Database, name: string) {
  const id = randomUUID();
  await db.execute(sql`insert into auth.users(id) values(${id}::uuid)`);
  await db.insert(profiles).values({ id, nickname: name });
  return id;
}
test("PostgreSQL market: concurrent approval, preserved terms, moderator refund and signed reordered callbacks retain the right grant", async () => {
  const a = createDatabase(url.toString(), 1),
    b = createDatabase(url.toString(), 1),
    service = libraryMarketService(a.db),
    library = libraryService(a.db),
    people: string[] = [];
  const globalDb = globalThis as unknown as {
      sliperConnection?: ReturnType<typeof createDatabase>;
    },
    priorConnection = globalDb.sliperConnection;
  const priorProvider = process.env.LIBRARY_PAYMENT_PROVIDER,
    priorSecret = process.env.LIBRARY_PAYMENT_WEBHOOK_SECRET;
  const secret = "temporary-local-market-signature-" + randomUUID();
  let entryId = "";
  globalDb.sliperConnection = a;
  process.env.LIBRARY_PAYMENT_PROVIDER = "test-library-bridge";
  process.env.LIBRARY_PAYMENT_WEBHOOK_SECRET = secret;
  async function callback(event: unknown, signatureOverride?: string) {
    const body = JSON.stringify(event),
      ts = String(Math.floor(Date.now() / 1000));
    const signature =
      signatureOverride ??
      createHmac("sha256", secret)
        .update(ts + ".")
        .update(body)
        .digest("hex");
    const r = await POST(
      new Request("http://127.0.0.1:3000/api/payments/library-webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sliper-timestamp": ts,
          "x-sliper-signature": signature,
        },
        body,
      }),
    );
    assert.equal(r.headers.get("cache-control"), "private, no-store");
    return {
      status: r.status,
      result: (await r.json()) as {
        ok: boolean;
        data?: { duplicate: boolean; status: string };
        error?: unknown;
      },
    };
  }
  try {
    const seller = await member(a.db, "시장 검증 판매자"),
      buyer = await member(a.db, "시장 검증 구매자"),
      secondBuyer = await member(a.db, "역순 검증 구매자"),
      moderator = await member(a.db, "시장 검증 운영자");
    people.push(seller, buyer, secondBuyer, moderator);
    await a.db.insert(staffRoles).values({ userId: moderator, role: "moderator" });
    const entry = await library.create(seller, content);
    entryId = entry.id;
    const first = await service.request(buyer, entry.id, {
      version: 1,
      externalReference: "NATIVE-" + randomUUID(),
      note: "정확한 이용 조건 확인",
      consent: true,
    });
    const approve = {
      action: "approve",
      expectedUpdatedAt: first.updatedAt,
      note: "외부 결제 완료 확인",
      paymentChecked: true,
    };
    const results = await Promise.allSettled([
      service.decide(seller, first.id, approve),
      libraryMarketService(b.db).decide(seller, first.id, approve),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const rejected = results.find((r) => r.status === "rejected");
    assert.ok(rejected?.status === "rejected" && code("CONFLICT")(rejected.reason));
    assert.ok((await library.detail(buyer, entry.id)).payload);
    const buyerProfile = (await a.db.select().from(profiles).where(eq(profiles.id, buyer)))[0]!;
    await assert.rejects(
      library.decideAccess(seller, entry.id, {
        userPublicId: buyerProfile.publicId,
        decision: "revoke",
        note: "구형 API 우회 시도",
        paymentChecked: false,
      }),
      code("CONFLICT"),
    );
    const old = await library.detail(seller, entry.id),
      saved = await library.saveDraft(seller, entry.id, {
        content: {
          ...content,
          usageTerms: "다음 버전에서는 작성자가 정한 변경된 이용 조건을 사용합니다.",
        },
        expectedUpdatedAt: old.updatedAt,
      });
    await library.publish(seller, entry.id, {
      expectedUpdatedAt: saved.updatedAt,
      changeSummary: "이용 조건 변경 발행",
      publicContentConsent: true,
    });
    assert.equal((await service.detail(buyer, first.id)).snapshot.usageTerms, content.usageTerms);
    const claim = await service.openDispute(buyer, first.id, {
      kind: "terms",
      body: "구매 당시의 이용 조건과 현재 자료 조건이 달라 환불 검토를 요청합니다.",
    });
    const dispute = claim.disputes[0]!;
    await assert.rejects(
      service.resolve(seller, first.id, dispute.id, {
        expectedUpdatedAt: dispute.updatedAt,
        outcome: "no_action",
        note: "판매자 스스로 종결 시도",
        paymentChecked: false,
      }),
      code("FORBIDDEN"),
    );
    const responded = await service.respond(seller, first.id, dispute.id, {
      expectedUpdatedAt: dispute.updatedAt,
      body: "외부 구매 플랫폼에서 전액 환불을 진행하고 처리 완료를 확인했습니다.",
    });
    const finished = await service.resolve(moderator, first.id, dispute.id, {
      expectedUpdatedAt: responded.disputes[0]!.updatedAt,
      outcome: "refund_confirmed",
      note: "외부 플랫폼의 전액 환불 완료 확인",
      paymentChecked: true,
    });
    assert.equal(finished.status, "refunded");
    assert.equal((await library.detail(buyer, entry.id)).payload, null);
    const next = await service.request(buyer, entry.id, {
      version: 2,
      externalReference: "REBUY-" + randomUUID(),
      note: "새 버전 조건을 확인했습니다.",
      consent: true,
    });
    const paid = {
      eventId: "PAID-" + randomUUID(),
      purchaseId: next.id,
      paymentId: "PAY-" + randomUUID(),
      type: "paid",
      amountKRW: 1000,
      currency: "KRW",
    };
    assert.equal((await callback(paid, "0".repeat(64))).status, 403);
    const payment = await callback(paid);
    assert.equal(payment.status, 200);
    assert.equal(payment.result.data?.status, "paid");
    assert.equal((await callback(paid)).result.data?.duplicate, true);
    assert.equal((await callback({ ...paid, amountKRW: 2000 })).status, 409);
    const lateRefund = {
      ...paid,
      eventId: "LATE-" + randomUUID(),
      purchaseId: first.id,
      paymentId: "ORIGINAL-" + randomUUID(),
      type: "refunded",
    };
    assert.equal((await callback(lateRefund)).status, 200);
    assert.ok((await library.detail(buyer, entry.id)).payload);
    const third = await service.request(secondBuyer, entry.id, {
      version: 2,
      externalReference: "REORDER-" + randomUUID(),
      note: "역순 환불 알림 검사",
      consent: true,
    });
    const reorder = {
      ...paid,
      eventId: "REFUND-FIRST-" + randomUUID(),
      purchaseId: third.id,
      paymentId: "REORDER-PAY-" + randomUUID(),
      type: "refunded",
    };
    assert.equal((await callback(reorder)).result.data?.status, "refunded");
    assert.equal(
      (await callback({ ...reorder, eventId: "LATE-PAID-" + randomUUID(), type: "paid" })).result
        .data?.status,
      "refunded",
    );
    assert.equal((await library.detail(secondBuyer, entry.id)).payload, null);
    await assert.rejects(
      a.db
        .update(libraryPurchases)
        .set({ snapshot: { ...next.snapshot, priceKRW: 1 } })
        .where(eq(libraryPurchases.id, next.id)),
    );
    const details: PurchaseDetail = await service.detail(buyer, next.id);
    assert.equal(JSON.stringify(details).includes("PRIVATE-NATIVE-MARKET"), false);
  } finally {
    try {
      if (entryId) {
        const ids = (
          await a.db
            .select({ id: libraryPurchases.id })
            .from(libraryPurchases)
            .where(eq(libraryPurchases.entryId, entryId))
        ).map((p) => p.id);
        if (ids.length) {
          await a.db
            .delete(libraryPurchaseDisputes)
            .where(inArray(libraryPurchaseDisputes.purchaseId, ids));
          await a.db
            .delete(libraryWebhookReceipts)
            .where(inArray(libraryWebhookReceipts.purchaseId, ids));
          await a.db
            .delete(libraryPurchaseAudit)
            .where(inArray(libraryPurchaseAudit.purchaseId, ids));
          await a.db.delete(libraryPurchases).where(inArray(libraryPurchases.id, ids));
        }
        await a.db.delete(libraryAccessRequests).where(eq(libraryAccessRequests.entryId, entryId));
        await a.db.delete(libraryEntries).where(eq(libraryEntries.id, entryId));
      }
      for (const id of people) await a.db.execute(sql`delete from auth.users where id=${id}::uuid`);
    } finally {
      if (priorConnection) globalDb.sliperConnection = priorConnection;
      else delete globalDb.sliperConnection;
      if (priorProvider === undefined) delete process.env.LIBRARY_PAYMENT_PROVIDER;
      else process.env.LIBRARY_PAYMENT_PROVIDER = priorProvider;
      if (priorSecret === undefined) delete process.env.LIBRARY_PAYMENT_WEBHOOK_SECRET;
      else process.env.LIBRARY_PAYMENT_WEBHOOK_SECRET = priorSecret;
      await Promise.all([a.close(), b.close()]);
    }
  }
});
