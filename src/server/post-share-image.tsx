import { ImageResponse } from "next/og";
import { ogTitleText, type PublicPostShare } from "../domain/post-sharing";

export function renderPostShareImage(
  post: PublicPostShare,
  assets: { font: Buffer; logo: Buffer; coverage: ReadonlySet<number> },
) {
  const title = ogTitleText(post.title, assets.coverage);
  const fontSize = Array.from(title).length > 55 ? 42 : 52;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "54px 64px",
        background: "#f4f9ff",
        color: "#171d27",
        fontFamily: "SliperShareSans",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <img
          src={`data:image/png;base64,${assets.logo.toString("base64")}`}
          width={64}
          height={64}
          style={{ borderRadius: 18 }}
        />
        <div style={{ display: "flex", fontSize: 39, fontWeight: 600, color: "#0A84FE" }}>
          Sliper
        </div>
        <div style={{ display: "flex", marginLeft: 8, fontSize: 23, color: "#60728b" }}>
          일상에 예능 한 스푼
        </div>
      </div>
      <div style={{ display: "flex", marginTop: 55 }}>
        <div
          style={{
            display: "flex",
            padding: "9px 18px",
            background: "#e3efff",
            color: "#086fda",
            borderRadius: 12,
            fontSize: 24,
          }}
        >
          {post.category} · {post.kind}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 25,
          fontSize,
          fontWeight: 600,
          lineHeight: 1.35,
          maxHeight: 218,
          overflow: "hidden",
          wordBreak: "break-word",
        }}
      >
        {title}
      </div>
      <div
        style={{
          display: "flex",
          marginTop: "auto",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: 20,
          borderTop: "1px solid #dce6f3",
        }}
      >
        <div style={{ display: "flex", fontSize: 25, color: "#50627a" }}>
          슬쩍 나와서 리얼하게 노는 퍼블릭 모임
        </div>
        <div style={{ display: "flex", fontSize: 23, color: "#0A84FE" }}>글과 댓글 보러 가기 →</div>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: [{ name: "SliperShareSans", data: assets.font, style: "normal", weight: 600 }],
      headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" },
    },
  );
}
