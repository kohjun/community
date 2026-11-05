// `primary` items stay in the header; the rest live under "더보기" so first-time visitors see a short menu.
export const SITE_NAVIGATION = [
  { id: "home", label: "홈", href: "/", primary: true },
  { id: "stories", label: "이야기", href: "/stories", primary: true },
  { id: "lightning", label: "번개 모임", href: "/lightning", primary: true },
  { id: "map", label: "이벤트 맵", href: "/map", primary: false },
  { id: "archive", label: "아카이브", href: "/archive", primary: true },
  { id: "games", label: "웹 게임", href: "/games", primary: true },
  { id: "players", label: "플레이어·크루", href: "/players", primary: false },
] as const;

export type NavigationSection = (typeof SITE_NAVIGATION)[number]["id"];
export type CommunityNavigationSection = "home" | "stories";

export function activeNavigationSection(
  pathname: string | null,
  communitySection?: CommunityNavigationSection,
): NavigationSection | null {
  if (!pathname) return null;
  const path = pathname.replace(/\/+$/, "") || "/";
  if ((path === "/" || path === "/stories") && communitySection) return communitySection;
  if (path === "/") return "home";
  if (path.startsWith("/posts/")) return "stories";
  if (path === "/crews" || path.startsWith("/crews/")) return "players";
  if (path === "/records" || path.startsWith("/records/")) return "archive";
  if (path === "/templates" || path.startsWith("/templates/")) return "archive";
  return (
    SITE_NAVIGATION.find(({ href }) => path === href || path.startsWith(href + "/"))?.id ?? null
  );
}
