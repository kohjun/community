import { apiResponse } from "@/server/http";
import { gameService, gameContext } from "@/server/game-http";
import { roomRealtime } from "@/server/room-realtime-runtime";
import { openRoomEventStream } from "@/server/room-realtime-core";
import { AppError } from "@/server/errors";
import { gameRoomId } from "@/domain/game-room";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  try {
    const { roomId: value } = await params,
      roomId = gameRoomId.parse(value);
    const who = await gameContext(
      request,
      roomId,
      new URL(request.url).searchParams.get("host") === "1",
    );
    const service = gameService();
    const stream = await openRoomEventStream({
      roomId,
      signal: request.signal,
      bus: roomRealtime(),
      readRoom: async () => {
        const view = await service.read(roomId, who);
        if (!view.isHost && !["waiting", "admitted"].includes(view.viewer.status))
          throw new AppError("FORBIDDEN", "입장한 참가자만 실시간으로 연결할 수 있어요.");
        return view;
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "private, no-store, no-transform",
        "X-Accel-Buffering": "no",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    return apiResponse(async () => {
      throw error;
    });
  }
}
