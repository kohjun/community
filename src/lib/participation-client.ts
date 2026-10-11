import { appRequest } from "./api-client";
export function participationRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return appRequest<T>(`/api/participation${path}`, method, body, signal);
}
