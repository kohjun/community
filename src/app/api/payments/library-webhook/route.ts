import { getDatabase } from "@/db/client";
import { apiResponse, readBody } from "@/server/http";
import { AppError } from "@/server/errors";
import { libraryPaymentConfiguration } from "@/server/library-payment-config";
import { verifyPaymentSignature } from "@/server/payment-signature";
import { libraryMarketService } from "@/server/library-market-service";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return apiResponse(async () => {
    const config = libraryPaymentConfiguration();
    if (!config) throw new AppError("CONFLICT", "자료 결제 자동 승인이 연결되지 않았어요.");
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new AppError("VALIDATION", "JSON 형식으로 요청해주세요.");
    const body = await readBody(request, 64000);
    if (
      !verifyPaymentSignature(
        body,
        request.headers.get("x-sliper-timestamp"),
        request.headers.get("x-sliper-signature"),
        config.secret,
      )
    )
      throw new AppError("FORBIDDEN", "자료 결제 알림의 서명을 확인하지 못했어요.");
    let event: unknown;
    try {
      event = JSON.parse(body.toString("utf8"));
    } catch {
      throw new AppError("VALIDATION", "자료 결제 알림 형식을 확인해주세요.");
    }
    return libraryMarketService(getDatabase()).webhook(config.provider, event);
  });
}
