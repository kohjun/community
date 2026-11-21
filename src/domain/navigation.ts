import { EVENT_RECRUITMENTS_HREF } from "./meetup-types";
import { HOSTED_EVENTS_HREF } from "./workspace-navigation";

// Primary links are considered first when fitting the header row.
export const SITE_NAVIGATION = [
  { id: "home", label: "홈", href: "/", primary: true },
  { id: "stories", label: "이야기", href: "/stories", primary: true },
  { id: "lightning", label: "번개·모임", href: "/lightning", primary: true },
  { id: "map", label: "이벤트 맵", href: "/map", primary: false },
  { id: "archive", label: "아카이브", href: "/archive", primary: false },
  { id: "games", label: "웹 게임", href: "/games", primary: true },
  { id: "players", label: "플레이어·크루", href: "/players", primary: false },
] as const;

export type NavigationSection = (typeof SITE_NAVIGATION)[number]["id"];
export type CommunityNavigationSection = "home" | "stories";
export type SiteNavigationOverride = CommunityNavigationSection | "events" | "management";
export type ActiveNavigationSection = NavigationSection | SiteNavigationOverride;

// Viewing mode changes presentation; authorization remains on the server.
export const AUDIENCE_NAVIGATION = {
  participant: {
    primary: [
      { id: "stories", label: "이야기", href: "/stories" },
      { id: "events", label: "이벤트·행사", href: EVENT_RECRUITMENTS_HREF },
      { id: "lightning", label: "번개·모임", href: "/lightning" },
      { id: "games", label: "웹게임", href: "/games" },
    ],
    more: [
      { id: "players", label: "플레이어", href: "/players" },
      { id: "map", label: "이벤트 맵", href: "/map" },
      { id: "ideas", label: "모임 제안하기", href: "/ideas" },
      { id: "archive", label: "아카이브", href: "/archive" },
    ],
  },
  host: {
    primary: [
      { id: "management", label: "모임 관리", href: HOSTED_EVENTS_HREF },
      { id: "archive", label: "아카이브", href: "/archive" },
      { id: "players", label: "크루", href: "/players?tab=crews" },
      { id: "games", label: "웹게임", href: "/games" },
    ],
    more: [
      { id: "hosting-guide", label: "호스트 가이드", href: "/hosting-guide" },
      { id: "stories", label: "이야기", href: "/stories" },
    ],
  },
} as const;

export function activeNavigationSection(
  pathname: string | null,
  override?: SiteNavigationOverride,
): ActiveNavigationSection | null {
  if (!pathname) return null;
  const path = pathname.replace(/\/+$/, "") || "/";
  if ((path === "/" || path === "/stories") && override && override !== "management")
    return override;
  if (path === "/") return "home";
  if (path === "/management" || path.startsWith("/management/")) return "management";
  if (path === "/mypage" && override === "management") return "management";
  if (path.startsWith("/posts/")) return "stories";
  if (path === "/crews" || path.startsWith("/crews/")) return "players";
  if (path === "/records" || path.startsWith("/records/")) return "archive";
  if (path === "/templates" || path.startsWith("/templates/")) return "archive";
  return (
    SITE_NAVIGATION.find(({ href }) => path === href || path.startsWith(href + "/"))?.id ?? null
  );
}
