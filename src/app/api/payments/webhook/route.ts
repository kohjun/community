import { getDatabase } from "@/db/client";
import { apiResponse, readBody } from "@/server/http";
import { AppError } from "@/server/errors";
import { paymentConfiguration } from "@/server/payment-gateway";
import { verifyPaymentSignature } from "@/server/payment-signature";
import { participationService } from "@/server/participation-service";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return apiResponse(async () => {
    const config = paymentConfiguration();
    if (!config) throw new AppError("CONFLICT", "외부 결제 연동이 설정되지 않았어요.");
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new AppError("VALIDATION", "JSON 형식이 필요해요.");
    const body = await readBody(request, 64000);
    if (
      !verifyPaymentSignature(
        body,
        request.headers.get("x-sliper-timestamp"),
        request.headers.get("x-sliper-signature"),
        config.secret,
      )
    )
      throw new AppError("FORBIDDEN", "결제 알림을 검증하지 못했어요.");
    let event: unknown;
    try {
      event = JSON.parse(body.toString("utf8"));
    } catch {
      throw new AppError("VALIDATION", "결제 알림 형식을 확인해주세요.");
    }
    return participationService(getDatabase()).payment(config.provider, event);
  });
}
