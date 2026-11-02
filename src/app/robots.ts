import type { MetadataRoute } from "next";
import { searchOrigin } from "@/domain/search-visibility";
export const dynamic = "force-dynamic";
export default function robots(): MetadataRoute.Robots {
  const origin = searchOrigin();
  return origin
    ? {
        rules: {
          userAgent: "*",
          allow: "/",
          disallow: [
            "/api/",
            "/auth/",
            "/admin",
            "/settings/",
            "/mypage",
            "/management",
            "/participation",
            "/records",
            "/players",
            "/crews/",
            "/login",
            "/search",
            "/discover/saved",
          ],
        },
        sitemap: `${origin}/sitemap.xml`,
        host: origin,
      }
    : { rules: { userAgent: "*", disallow: "/" } };
}
