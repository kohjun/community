import type { AppErrorCode } from "../domain/contracts";

export class AppError extends Error {
  constructor(
    public code: AppErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function requireActor(actor: string | null): string {
  if (!actor)
    throw new AppError(
      "UNAUTHENTICATED",
      "로그인 후 이용할 수 있어요. 이용 제한 중이라면 계정·안전 설정을 확인해주세요.",
    );
  return actor;
}
