import { z } from "zod";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { participationService } from "@/server/participation-service";
import { apiResponse } from "@/server/http";
import { requireActor } from "@/server/errors";
import { roomRealtime } from "@/server/room-realtime";
import { openRoomEventStream } from "@/server/room-realtime-core";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  try {
    const { postId } = await params;
    const id = z.uuid().parse(postId).toLowerCase();
    const actor = requireActor(await currentActor());
    const service = participationService(getDatabase());
    const stream = await openRoomEventStream({
      roomId: id,
      signal: request.signal,
      readRoom: () => service.room(actor, id),
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
