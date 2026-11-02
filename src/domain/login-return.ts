import { safeProfileReturnTo } from "./profile";

/** Resolve the canonical query, with legacy links accepted only through the same safety checks. */
export function loginReturnTo(params: { returnTo?: unknown; next?: unknown }): string {
  let target = params.returnTo ?? params.next;
  if (target === undefined) return "/";
  if (
    typeof target === "string" &&
    target.startsWith("/") &&
    !/[\\\u0000-\u001f\u007f]/.test(target)
  ) {
    try {
      const url = new URL(target, "https://sliper.local");
      if (url.origin === "https://sliper.local" && url.pathname === "/signup")
        target = url.searchParams.get("returnTo") ?? "/mypage";
    } catch {
      return "/mypage";
    }
  }
  return safeProfileReturnTo(target);
}

export function loginHref(returnTo: unknown = "/"): string {
  return "/login?returnTo=" + encodeURIComponent(loginReturnTo({ returnTo }));
}
