import { notFound } from "next/navigation";
import { gameRoomId } from "@/domain/game-room";
import { GameRoomLobby } from "@/components/game-room-lobby";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parsed = gameRoomId.safeParse((await params).roomId);
  if (!parsed.success) notFound();
  const host = (await searchParams).host === "1";
  return <GameRoomLobby key={`${parsed.data}:${host}`} roomId={parsed.data} host={host} />;
}
