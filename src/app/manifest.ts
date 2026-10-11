import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Sliper — 슬리퍼 커뮤니티",
    short_name: "Sliper",
    description: "취향 맞는 사람들과 함께하는 예능 모임과 이야기",
    lang: "ko",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0A84FE",
    icons: [
      { src: "/images/sliper-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/images/sliper-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
