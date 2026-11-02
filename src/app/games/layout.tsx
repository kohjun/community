import type { Metadata } from "next";
import { ParticipationShell } from "@/components/participation-shell";
export const metadata: Metadata = {
  title: "함께하는 웹 게임 | Sliper",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ParticipationShell advertising={false}>{children}</ParticipationShell>;
}
