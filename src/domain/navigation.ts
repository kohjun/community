export const SITE_NAVIGATION = [
  { id: "home", label: "홈", href: "/" },
  { id: "stories", label: "이야기", href: "/stories" },
  { id: "topics", label: "주제 탐색", href: "/topics" },
  { id: "lightning", label: "번개 모임", href: "/lightning" },
  { id: "map", label: "이벤트 맵", href: "/map" },
  { id: "archive", label: "아카이브", href: "/archive" },
  { id: "records", label: "행사 기록", href: "/records" },
  { id: "players", label: "플레이어·크루", href: "/players" },
  { id: "search", label: "통합 검색", href: "/search" },
  { id: "management", label: "내 행사", href: "/management" },
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
  if (path.startsWith("/posts/")) return "stories";
  if (path === "/crews" || path.startsWith("/crews/")) return "players";
  if (path === "/templates" || path.startsWith("/templates/")) return "archive";
  return (
    SITE_NAVIGATION.find(({ href }) =>
      href === "/" ? path === "/" : path === href || path.startsWith(href + "/"),
    )?.id ?? null
  );
}
