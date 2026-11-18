import { GameRunResult } from "@/components/game-run-result";
import { gameRoomId } from "@/domain/game-room";
import { notFound } from "next/navigation";
export const metadata = {
  title: "우리의 게임 기록 | Sliper",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ roomId: string; runId: string }>;
}) {
  const p = await params;
  if (!gameRoomId.safeParse(p.roomId).success || !gameRoomId.safeParse(p.runId).success) notFound();
  return <GameRunResult roomId={p.roomId} runId={p.runId} />;
}
