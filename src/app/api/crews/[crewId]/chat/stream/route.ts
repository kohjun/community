import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { crewService } from "@/server/crew-service";
import { apiResponse } from "@/server/http";
import { uuidSchema } from "@/domain/validation";
import { crewChatQuerySchema } from "@/domain/crew-chat";
import { openRoomEventStream } from "@/server/room-realtime-core";
import { roomRealtime } from "@/server/room-realtime-runtime";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request, { params }: { params: Promise<{ crewId: string }> }) {
  try {
    const id = uuidSchema.parse((await params).crewId);
    const query = crewChatQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const actor = await currentActor();
    const service = crewService(getDatabase());
    const stream = await openRoomEventStream({
      roomId: id,
      signal: request.signal,
      readRoom: () => service.chat(actor, id, query),
      bus: roomRealtime(),
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "private, no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return apiResponse(async () => {
      throw error;
    });
  }
}
