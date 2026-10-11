import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/connection";
import { libraryPurchases } from "../db/library-schema";
import { libraryTestPurchaseSchema } from "../domain/library-test-purchase";
import { uuidSchema } from "../domain/validation";
import { AppError } from "./errors";
import { isLocalTestEnvironment } from "./local-test-auth";
import { libraryService } from "./library-service";
import { libraryMarketService } from "./library-market-service";
import { requireRecordMember } from "./record-policy";

// No flag can activate this simulator on a production build or a remote database.
export function localLibraryPurchaseEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    isLocalTestEnvironment(env) &&
    !env.LIBRARY_PAYMENT_PROVIDER &&
    !env.LIBRARY_PAYMENT_WEBHOOK_SECRET
  );
}

export function libraryTestPurchaseService(db: Database, env: NodeJS.ProcessEnv = process.env) {
  return {
    async purchase(actor: string | null, id: string, input: unknown) {
      if (!localLibraryPurchaseEnabled(env))
        throw new AppError(
          "NOT_FOUND",
          "테스트 구매는 외부 결제가 연결되지 않은 로컬 개발 환경에서만 사용할 수 있어요.",
        );
      const user = await requireRecordMember(db, actor),
        value = libraryTestPurchaseSchema.parse(input);
      uuidSchema.parse(id);
      return db.transaction(async (tx) => {
        const connection = tx as unknown as Database;
        // The archive reader locks the source, so concurrent clicks share one completed order.
        const source = await libraryService(connection).detail(user, id);
        if (source.status !== "published" || source.isMine || source.priceKRW <= 0)
          throw new AppError(
            "VALIDATION",
            "다른 회원이 발행한 유료 자료에서 테스트 구매를 진행해주세요.",
          );
        if (source.publishedVersion !== value.version)
          throw new AppError("CONFLICT", "자료의 최신 버전과 이용 조건을 다시 확인해주세요.");
        const market = libraryMarketService(connection);
        const [prior] = await tx
          .select()
          .from(libraryPurchases)
          .where(
            and(
              eq(libraryPurchases.entryId, id),
              eq(libraryPurchases.buyerId, user),
              inArray(libraryPurchases.status, ["pending", "paid"]),
            ),
          );
        if (prior) {
          if (prior.status === "paid" && prior.provider === "local-test")
            return market.detail(user, prior.id);
          throw new AppError(
            "CONFLICT",
            "기존 구매 확인 내역이 있어요. 내 구매에서 먼저 확인해주세요.",
          );
        }
        const order = await market.request(user, id, {
          version: value.version,
          externalReference: "SLIPER-TEST-" + randomUUID(),
          note: value.note,
          consent: value.consent,
        });
        await market.webhook("local-test", {
          eventId: "TEST-PAID-" + order.id,
          purchaseId: order.id,
          paymentId: "TEST-PAYMENT-" + order.id,
          type: "paid",
          amountKRW: order.amountKRW,
          currency: "KRW",
        });
        return market.detail(user, order.id);
      });
    },
  };
}
