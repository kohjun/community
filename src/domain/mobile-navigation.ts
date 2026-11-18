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
  // The tab is 이벤트·행사; 번개·모임 lives in the explore sheet, so it is not highlighted here.
  if (
    /^\/(?:events|map)(?:\/|$)/.test(path) ||
    (path === "/" && query.get("kind") === "모집" && query.get("meetupType") !== "lightning")
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
