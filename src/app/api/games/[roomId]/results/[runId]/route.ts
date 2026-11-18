import { apiResponse } from "@/server/http";
import { gameContext } from "@/server/game-http";
import { readGameRun } from "@/server/game-run-service";
import { getDatabase } from "@/db/client";
import { gameRoomId } from "@/domain/game-room";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ roomId: string; runId: string }> },
) {
  return apiResponse(async () => {
    const p = await params,
      roomId = gameRoomId.parse(p.roomId),
      runId = gameRoomId.parse(p.runId);
    return readGameRun(
      getDatabase(),
      roomId,
      runId,
      await gameContext(request, roomId, new URL(request.url).searchParams.get("host") === "1"),
    );
  });
}
