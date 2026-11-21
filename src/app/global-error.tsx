"use client";
import { useEffect } from "react";
import { captureClientException } from "@/lib/analytics-client";

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    captureClientException(error, { boundary: "global" });
  }, [error]);

  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#f8fafc",
          color: "#0f172a",
        }}
      >
        <main style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>
            화면을 불러오는 중 문제가 생겼어요.
          </h1>
          <p style={{ color: "#475569", marginBottom: "1.25rem", lineHeight: 1.5 }}>
            일시적인 오류일 수 있습니다. 잠시 후 다시 시도해주세요.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              height: 40,
              padding: "0 18px",
              border: 0,
              borderRadius: 999,
              background: "#0a84fe",
              color: "#ffffff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            다시 불러오기
          </button>
        </main>
      </body>
    </html>
  );
}
