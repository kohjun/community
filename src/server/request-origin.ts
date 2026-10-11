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
