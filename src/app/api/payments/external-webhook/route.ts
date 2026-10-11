import { getDatabase } from "@/db/client";
import { apiResponse, readBody } from "@/server/http";
import { AppError } from "@/server/errors";
import { externalApprovalConfiguration } from "@/server/external-approval-config";
import { verifyPaymentSignature } from "@/server/payment-signature";
import { participationService } from "@/server/participation-service";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return apiResponse(async () => {
    const config = externalApprovalConfiguration();
    if (!config) throw new AppError("CONFLICT", "외부 참가 자동 승인 연동이 설정되지 않았어요.");
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new AppError("VALIDATION", "JSON 형식으로 요청해주세요.");
    const raw = await readBody(request, 64000);
    if (
      !verifyPaymentSignature(
        raw,
        request.headers.get("x-sliper-timestamp"),
        request.headers.get("x-sliper-signature"),
        config.secret,
      )
    )
      throw new AppError("FORBIDDEN", "외부 결제 확인 알림을 검증하지 못했어요.");
    let value: unknown;
    try {
      value = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new AppError("VALIDATION", "알림 형식을 확인해주세요.");
    }
    return participationService(getDatabase()).externalPayment(config.provider, value);
  });
}
