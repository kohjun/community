import "server-only";
import { townSecret, townSignature } from "./town-ticket";
import { AppError } from "./errors";
export async function townInternal(
  path: "/internal/evidence" | "/internal/refresh" | "/internal/world" | "/internal/session",
  value: unknown,
) {
  const port = Number(process.env.TOWN_PORT ?? 13003);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new AppError("INTERNAL", "타운 연결 설정을 확인해주세요.");
  const body = JSON.stringify(value),
    time = String(Date.now());
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Town-Time": time,
        "X-Town-Signature": townSignature(`${time}\n${path}\n${body}`, townSecret()),
      },
      body,
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error();
    return (await response.json()) as {
      publicId: string;
      text: string;
      roomId: string;
      identity: string;
      worldId: string;
    };
  } catch {
    throw new AppError(
      "CONFLICT",
      "광장에 연결한 상태에서 다시 시도해주세요. 오래된 대화는 신고할 수 없어요.",
    );
  }
}
