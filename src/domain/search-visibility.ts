import type { Metadata, MetadataRoute } from "next";

export const SEARCH_PAGES = [
  {
    path: "/",
    title: "Sliper — 일상에 예능 한 스푼",
    description:
      "취향이 만나는 예능 모임 커뮤니티. 이야기와 번개 모임, 진행에 도움이 되는 자료를 만나보세요.",
  },
  {
    path: "/stories",
    title: "이야기 | Sliper",
    description: "예능 콘텐츠와 모임에 관한 질문, 경험과 아이디어를 나눠요.",
  },
  {
    path: "/lightning",
    title: "번개 모임 | Sliper",
    description: "가까운 곳에서 취향이 맞는 사람들과 가볍게 만나요.",
  },
  {
    path: "/map",
    title: "이벤트 맵 | Sliper",
    description: "모임을 열기 좋은 장소와 이벤트를 지도에서 찾아보세요.",
  },
  {
    path: "/archive",
    title: "기획 자료 아카이브 | Sliper",
    description: "룰북과 이벤트 템플릿, 처음 진행하는 사람을 위한 운영 가이드를 찾아보세요.",
  },
  {
    path: "/hosting-guide",
    title: "처음 여는 모임 · 4주 운영 가이드 | Sliper",
    description: "한 지역, 주최자 3~5명으로 작게 시작하고 매회 개선하는 모임 운영 안내.",
  },
  {
    path: "/about",
    title: "Sliper 소개",
    description: "만남의 경험과 운영 노하우가 다음 모임으로 이어지는 커뮤니티 Sliper를 소개합니다.",
  },
  {
    path: "/help",
    title: "이용 안내 | Sliper",
    description: "첫 참가와 모임 운영, 계정과 안전에 관한 Sliper 이용 안내.",
  },
  {
    path: "/policies/community",
    title: "커뮤니티 이용규칙 | Sliper",
    description: "함께 안심하고 참여하기 위한 Sliper 커뮤니티 이용규칙.",
  },
  {
    path: "/policies/privacy",
    title: "개인정보 처리 안내 | Sliper",
    description: "Sliper의 정보 처리 목적, 공개 범위와 개인정보 요청 방법.",
  },
  {
    path: "/policies/terms",
    title: "서비스 이용약관 | Sliper",
    description: "Sliper 서비스의 이용 기준, 이용자의 권리와 운영자의 책임 안내.",
  },
  {
    path: "/policies/refunds",
    title: "취소·환불 안내 | Sliper",
    description: "Sliper 모임의 취소 요청과 외부 플랫폼 거래 안내.",
  },
] as const;

export function searchOrigin(env: Record<string, string | undefined> = process.env): string | null {
  if (
    env.NODE_ENV !== "production" ||
    env.LOCAL_DATABASE === "1" ||
    env.SLIPER_SEARCH_INDEXING_ENABLED !== "true"
  )
    return null;
  try {
    const url = new URL(env.APP_ORIGIN ?? "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(url.hostname) ||
      /(?:^|\.)(?:example|test|invalid|local|localhost|internal)$/.test(url.hostname)
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function publicPageMetadata(
  path: string,
  personal = false,
  env: Record<string, string | undefined> = process.env,
): Metadata {
  const page = SEARCH_PAGES.find((item) => item.path === path);
  const origin = searchOrigin(env);
  if (!origin || !page || personal) return { robots: { index: false, follow: false } };
  const canonical = new URL(path, origin).href;
  return {
    title: page.title,
    description: page.description,
    robots: { index: true, follow: true },
    alternates: { canonical },
    openGraph: {
      type: "website",
      locale: "ko_KR",
      siteName: "Sliper",
      title: page.title,
      description: page.description,
      url: canonical,
    },
  };
}

export function publicSitemap(
  env: Record<string, string | undefined> = process.env,
): MetadataRoute.Sitemap {
  const origin = searchOrigin(env);
  return origin ? SEARCH_PAGES.map((page) => ({ url: new URL(page.path, origin).href })) : [];
}

/** Identity is still verified inside media handlers; only cookie refresh is skipped. */
export function skipSessionRefresh(path: string, method: string): boolean {
  return (
    ["GET", "HEAD"].includes(method) &&
    (path === "/api/health" ||
      /^\/api\/games\/[a-f0-9-]{36}\/stream$/i.test(path) ||
      [
        "/robots.txt",
        "/sitemap.xml",
        "/ads.txt",
        "/support",
        "/about",
        "/help",
        "/policies/privacy",
        "/policies/terms",
        "/policies/community",
        "/policies/refunds",
      ].includes(path) ||
      /^\/api\/(?:media|profile-photos)\/[a-f0-9-]{36}$/i.test(path))
  );
}
