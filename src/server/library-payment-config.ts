import "server-only";
import { AppError } from "./errors";

/** Dedicated bridge for library sales; event payment credentials never authorize this endpoint. */
export function libraryPaymentConfiguration() {
  const provider = process.env.LIBRARY_PAYMENT_PROVIDER,
    secret = process.env.LIBRARY_PAYMENT_WEBHOOK_SECRET;
  if (!provider && !secret) return null;
  if (
    !provider ||
    !/^[a-zA-Z0-9_-]{1,40}$/.test(provider) ||
    ["manual", "local-test"].includes(provider) ||
    !secret ||
    secret.length < 32
  )
    throw new AppError("CONFLICT", "자료 결제 자동 승인 설정을 확인해주세요.");
  return { provider, secret };
}
