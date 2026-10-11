import "server-only";
import { ZodError } from "zod";
import { AppError } from "./errors";
import { localTestAccountEnabled } from "./local-test-auth";
import { isAllowedRequestOrigin } from "./request-origin";

export function assertSameOrigin(request: Request) {
  const expected = new URL(process.env.APP_ORIGIN || "http://127.0.0.1:3000").origin;
  const localDevelopment =
    process.env.NODE_ENV === "development" && process.env.LOCAL_DATABASE === "1";
  const testLan = localTestAccountEnabled() ? process.env.SLIPER_LAN_HOST : null;
  if (!isAllowedRequestOrigin(request, expected, localDevelopment, testLan)) {
    throw new AppError("FORBIDDEN", "이 사이트에서 요청을 다시 시도해주세요.");
  }
}

export async function readBody(request: Request, maxBytes = 150_000) {
  if (Number(request.headers.get("content-length") || 0) > maxBytes)
    throw new AppError("VALIDATION", "요청 크기가 너무 커요.");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("VALIDATION", "요청 내용을 확인해주세요.");
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AppError("VALIDATION", "요청 크기가 너무 커요.");
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

export async function readJson(request: Request, maxBytes = 150_000): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError("VALIDATION", "JSON 형식으로 요청해주세요.");
  try {
    return JSON.parse((await readBody(request, maxBytes)).toString("utf8"));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("VALIDATION", "요청 내용을 확인해주세요.");
  }
}

export async function apiResponse<T>(work: () => Promise<T>): Promise<Response> {
  try {
    return Response.json(
      { ok: true, data: await work() },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const value =
      error instanceof ZodError
        ? new AppError("VALIDATION", "입력값을 확인해주세요.")
        : error instanceof AppError
          ? error
          : new AppError("INTERNAL", "저장하지 못했어요. 잠시 후 다시 시도해주세요.");
    if (value.code === "INTERNAL")
      console.error(
        "Sliper request failed:",
        error instanceof Error ? error.name : "Unknown error",
      );
    const status = {
      VALIDATION: 400,
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      RATE_LIMITED: 429,
      INTERNAL: 500,
    }[value.code];
    return Response.json(
      { ok: false, error: { code: value.code, message: value.message } },
      { status, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
