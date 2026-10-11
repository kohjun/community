import "server-only";
import { AppError } from "./errors";
export function externalApprovalConfiguration() {
  const provider = process.env.EXTERNAL_APPROVAL_PROVIDER,
    secret = process.env.EXTERNAL_APPROVAL_WEBHOOK_SECRET;
  if (!provider && !secret) return null;
  if (
    !provider ||
    !/^[a-zA-Z0-9_-]{1,40}$/.test(provider) ||
    ["manual", "local-test"].includes(provider) ||
    !secret ||
    secret.length < 32
  )
    throw new AppError("CONFLICT", "외부 참가 승인 연동 설정을 확인해주세요.");
  return { provider, secret };
}
