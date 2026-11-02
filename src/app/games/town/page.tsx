import type { Metadata } from "next";
import { TownClient } from "@/components/town-client";
export const metadata: Metadata = {
  title: "슬리퍼 타운 | Sliper",
  robots: { index: false, follow: false },
  description: "아바타로 만나고 이야기하는 작은 야외 광장",
};
export default function Page() {
  return <TownClient />;
}
