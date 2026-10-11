import { ECDH } from "node:crypto";
import { AppError } from "./errors";

// Accept only known browser push services. Client-controlled HTTPS endpoints
// must never turn the sender into a general HTTP proxy or reach internal hosts.
export function validPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(endpoint)) return false;
  try {
    const u = new URL(endpoint);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.hash ||
      (u.port && u.port !== "443")
    )
      return false;
    const host = u.hostname.toLowerCase();
    return (
      host === "fcm.googleapis.com" ||
      host === "updates.push.services.mozilla.com" ||
      host.endsWith(".push.services.mozilla.com") ||
      host === "web.push.apple.com" ||
      host.endsWith(".push.apple.com") ||
      host.endsWith(".notify.windows.com")
    );
  } catch {
    return false;
  }
}
export function validateSubscriptionKeys(p256dh: string, auth: string) {
  try {
    const key = Buffer.from(p256dh, "base64url");
    if (key.length !== 65 || key[0] !== 4 || Buffer.from(auth, "base64url").length !== 16)
      throw new Error("Invalid subscription keys");
    ECDH.convertKey(key, "prime256v1");
  } catch {
    throw new AppError("VALIDATION", "이 기기의 알림 구독 정보를 다시 생성해주세요.");
  }
}
export function safePushPath(path: string) {
  if (/[\\\u0000-\u001f\u007f]/.test(path) || path.startsWith("//")) return false;
  return (
    /^\/\?post=[0-9a-f-]{36}$/i.test(path) ||
    /^\/(rooms|events)\/[0-9a-f-]{36}$/i.test(path) ||
    path === "/mypage" ||
    path === "/participation" ||
    path === "/notifications"
  );
}
