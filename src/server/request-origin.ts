import { configuredLocalTestLanHost } from "./local-test-access";

// Local aliases are accepted only in the isolated development environment and
// only when the browser Origin matches the actual request Host.
export function isAllowedRequestOrigin(
  request: Request,
  expectedOrigin: string,
  localDevelopment: boolean,
  allowedLanHost?: string | null,
) {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site") return false;
  const localOrigins = ["http://127.0.0.1:3000", "http://localhost:3000"];
  if (localDevelopment && localOrigins.includes(expectedOrigin)) {
    const lanHost = configuredLocalTestLanHost(allowedLanHost);
    const allowed = localOrigins.includes(origin) || (!!lanHost && origin === `http://${lanHost}`);
    if (!allowed) return false;
    return new URL(origin).host === request.headers.get("host");
  }
  return origin === expectedOrigin;
}

/** Keep local OAuth cookies on one host; API/mutation and callback requests are never redirected. */
export function canonicalLocalNavigation(request: Request, expectedOrigin: string): URL | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const expected = new URL(expectedOrigin);
  const allowed = ["http://127.0.0.1:3000", "http://localhost:3000"];
  if (!allowed.includes(expected.origin)) return null;
  const url = new URL(request.url);
  if (/^\/(?:api|auth|_next)(?:\/|$)/.test(url.pathname)) return null;
  const host = request.headers.get("host") ?? url.host;
  if (!allowed.some((origin) => new URL(origin).host === host) || host === expected.host)
    return null;
  const target = new URL(expected.origin);
  target.pathname = url.pathname;
  target.search = url.search;
  return target;
}
