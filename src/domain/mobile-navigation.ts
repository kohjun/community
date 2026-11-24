export type MobileSection = "home" | "meetups" | "notifications" | "my" | "explore";
export function mobileNavigationHidden(path: string) {
  return (
    /^\/(?:login|signup|auth|checkout|admin)(?:\/|$)/.test(path) || /\/(?:edit|new)$/.test(path)
  );
}
export function mobileSection(
  path: string,
  query: Pick<URLSearchParams, "get">,
): MobileSection | null {
  if (path === "/notifications") return "notifications";
  if (
    /^\/(?:mypage|management|participation|rooms|settings|account|support|discover)(?:\/|$)/.test(
      path,
    )
  )
    return "my";
  if (/^\/(?:events|map)(?:\/|$)/.test(path)) return "meetups";
  if (path === "/") {
    if (["mine", "bookmarks"].includes(query.get("view") ?? "")) return "my";
    if (query.get("kind") === "모집")
      return query.get("meetupType") === "lightning" ? "explore" : "meetups";
    if (!query.get("category") || query.get("category") === "all") {
      if (!query.get("view") || query.get("view") === "home") return "home";
    }
  }
  return "explore";
}
