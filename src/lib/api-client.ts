import { startTransition } from "react";
import type { AppErrorCode, ActionResult } from "@/domain/contracts";
export class RequestError extends Error {
  constructor(
    message: string,
    public readonly code: AppErrorCode | undefined,
  ) {
    super(message);
  }
}
const REQUEST_TIMEOUT_MS = 25_000;
const RESPONSE_ERROR = "서버 응답을 확인하지 못했어요. 잠시 후 다시 시도해주세요.";
export function actionData<T>(work: () => Promise<ActionResult<T>>): Promise<T> {
  return new Promise((resolve, reject) =>
    startTransition(async () => {
      try {
        const result = await work();
        if (!result.ok) throw new Error(result.error.message);
        resolve(result.data);
      } catch (error) {
        reject(error);
      }
    }),
  );
}
export async function appRequest<T>(
  url: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
      ...(body instanceof FormData
        ? { body }
        : body === undefined
          ? {}
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요.");
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(RESPONSE_ERROR);
  }
  if (!value || typeof value !== "object" || !("ok" in value)) throw new Error(RESPONSE_ERROR);
  const result = value as ActionResult<T>;
  if (result.ok === false) {
    const message = result.error?.message;
    throw new RequestError(
      typeof message === "string" ? message : RESPONSE_ERROR,
      result.error?.code,
    );
  }
  if (!response.ok || result.ok !== true || !("data" in result)) throw new Error(RESPONSE_ERROR);
  return result.data;
}

export function communityRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  return appRequest<T>(`/api/community${path}`, method, body, signal, timeoutMs);
}
