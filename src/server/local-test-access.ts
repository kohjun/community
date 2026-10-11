import { isLocalTestEnvironment, localTestAccountEnabled } from "./local-test-auth";
import { AppError } from "./errors";

export function configuredLocalTestLanHost(value: string | null | undefined): string | null {
  if (!value || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return null;
  const parts = value.split(".").map(Number);
  if (parts.some((part) => part > 255) || parts.join(".") !== value) return null;
  const [first, second] = parts;
  const privateAddress =
    first === 10 ||
    (first === 192 && second === 168) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31);
  return privateAddress ? `${value}:3000` : null;
}
export function allowedLocalTestHost(
  host: string | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isLocalTestEnvironment(env) || !host) return false;
  return (
    host === "127.0.0.1:3000" ||
    host === "localhost:3000" ||
    host === configuredLocalTestLanHost(env.SLIPER_LAN_HOST)
  );
}
export function localTestAuthAvailable(
  host: string | null,
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): boolean {
  return allowedLocalTestHost(host, env) && localTestAccountEnabled(env, cwd);
}

export class TestLoginThrottle {
  private failures = 0;
  private startedAt: number | null = null;
  private active = false;
  private refresh(now: number) {
    if (this.startedAt === null || now < this.startedAt || now - this.startedAt >= 60_000) {
      this.startedAt = now;
      this.failures = 0;
    }
  }
  begin(now = Date.now()) {
    this.refresh(now);
    if (this.active || this.failures >= 5)
      throw new AppError("RATE_LIMITED", "로그인 요청이 잠시 많아요. 1분 뒤에 다시 시도해주세요.");
    this.active = true;
  }
  finish(success: boolean, now = Date.now()) {
    this.active = false;
    this.refresh(now);
    if (success) this.failures = 0;
    else this.failures++;
  }
}
