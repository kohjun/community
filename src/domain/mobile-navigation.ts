export type MobileSection = "home" | "meetups" | "explore" | "notifications" | "my";
export function mobileNavigationHidden(path: string) {
  return (
    /^\/(?:login|signup|auth|checkout|admin)(?:\/|$)/.test(path) || /\/(?:edit|new)$/.test(path)
  );
}
export function mobileSection(path: string, query: Pick<URLSearchParams, "get">): MobileSection {
  if (path === "/notifications") return "notifications";
  if (
    /^\/(?:mypage|management|participation|rooms|settings|account|support|discover)(?:\/|$)/.test(
      path,
    )
  )
    return "my";
  if (
    /^\/(?:lightning|events|map)(?:\/|$)/.test(path) ||
    (path === "/" && query.get("kind") === "모집")
  )
    return "meetups";
  if (path === "/") {
    if (["mine", "bookmarks"].includes(query.get("view") ?? "")) return "my";
    if (!query.get("category") || query.get("category") === "all") {
      if (!query.get("view") || query.get("view") === "home") return "home";
    }
  }
  return "explore";
}
