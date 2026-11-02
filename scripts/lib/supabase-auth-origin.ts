/** Only URL configuration is retained; Management API responses may contain provider secrets. */
export interface AuthUrlConfiguration {
  site_url: string;
  uri_allow_list: string;
}
export class AuthOriginError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
const fail = (code: string): never => {
  throw new AuthOriginError(code);
};
export function normalizeAuthOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(url.hostname) ||
      /[*{}\\]/.test(url.hostname)
    )
      fail("INVALID_ORIGIN");
    return url.origin;
  } catch {
    return fail("INVALID_ORIGIN");
  }
}
function urlConfiguration(value: unknown): AuthUrlConfiguration {
  if (!value || typeof value !== "object") return fail("INVALID_RESPONSE");
  const config = value as Record<string, unknown>;
  if (
    typeof config.site_url !== "string" ||
    (config.uri_allow_list != null && typeof config.uri_allow_list !== "string")
  )
    return fail("INVALID_RESPONSE");
  return {
    site_url: config.site_url,
    uri_allow_list: config.uri_allow_list ?? "",
  } as AuthUrlConfiguration;
}
export function planAuthOrigin(current: unknown, originValue: string) {
  const previous = urlConfiguration(current);
  const origin = normalizeAuthOrigin(originValue);
  // Escape '?' because Supabase uses glob patterns. Wildcards apply only to query values.
  const requiredRedirects = [origin + "/auth/callback", origin + "/auth/callback\\?returnTo=**"];
  const entries = previous.uri_allow_list
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const added = requiredRedirects.filter((entry) => !entries.includes(entry));
  const next = {
    site_url: origin,
    // Preserve existing entries byte-for-byte; append only missing callback patterns.
    uri_allow_list: added.length
      ? previous.uri_allow_list + (previous.uri_allow_list.trim() ? "," : "") + added.join(",")
      : previous.uri_allow_list,
  };
  return {
    previous,
    next,
    addedRedirectCount: added.length,
    previousRedirectCount: entries.length,
    siteUrlChanged: previous.site_url !== next.site_url,
    changed: previous.site_url !== next.site_url || previous.uri_allow_list !== next.uri_allow_list,
  };
}
export interface AuthOriginOptions {
  projectRef: string;
  origin: string;
  token: string;
  apply: boolean;
  fetcher?: typeof fetch;
  backup?: (configuration: AuthUrlConfiguration) => Promise<void>;
}
export async function configureAuthOrigin(options: AuthOriginOptions) {
  const { projectRef, token, apply } = options;
  if (!/^[a-z]{20}$/.test(projectRef)) fail("INVALID_PROJECT_REF");
  normalizeAuthOrigin(options.origin);
  if (!/^sbp_[A-Za-z0-9_-]{16,}$/.test(token)) fail("SCOPED_MANAGEMENT_TOKEN_REQUIRED");
  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;
  const fetcher = options.fetcher ?? fetch;
  async function request(method: "GET" | "PATCH", body?: AuthUrlConfiguration) {
    let response: Response;
    try {
      response = await fetcher(endpoint, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      return fail("MANAGEMENT_REQUEST_FAILED");
    }
    // Error bodies can contain secrets. Never propagate or log them.
    if (!response.ok) fail("MANAGEMENT_HTTP_" + response.status);
    if (method === "PATCH") {
      await response.body?.cancel();
      return;
    }
    try {
      return urlConfiguration(await response.json());
    } catch {
      return fail("INVALID_RESPONSE");
    }
  }
  const plan = planAuthOrigin(await request("GET"), options.origin);
  if (apply && plan.changed) {
    const backup = options.backup;
    if (!backup) return fail("BACKUP_REQUIRED");
    const refreshed = urlConfiguration(await request("GET"));
    if (JSON.stringify(refreshed) !== JSON.stringify(plan.previous)) fail("CONFIGURATION_CHANGED");
    await backup(plan.previous);
    await request("PATCH", plan.next);
    const verified = urlConfiguration(await request("GET"));
    if (JSON.stringify(verified) !== JSON.stringify(plan.next)) fail("VERIFICATION_FAILED");
  }
  return {
    applied: apply && plan.changed,
    changed: plan.changed,
    siteUrlChanged: plan.siteUrlChanged,
    addedRedirectCount: plan.addedRedirectCount,
    previousRedirectCount: plan.previousRedirectCount,
    nextSiteUrl: plan.next.site_url,
    verified: apply,
    secretsDisplayed: false,
  };
}
