import type { Metadata } from "next";
import "./topics.css";
export const metadata: Metadata = {
  title: "주제 탐색 | Sliper",
  description: "취향이 닮은 이야기와 모임, 룰북과 이벤트 템플릿을 함께 찾아보세요.",
  robots: { index: false, follow: false },
};
export default function TopicsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
