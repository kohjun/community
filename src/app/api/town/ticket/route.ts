import { townInternal } from "@/server/town-internal";
import { getDatabase } from "@/db/client";
import { z } from "zod";
import { apiResponse, assertSameOrigin, readJson } from "@/server/http";
import { currentActor } from "@/server/identity";
import { AppError, requireActor } from "@/server/errors";
import { enforceRequestLimit } from "@/server/request-limits";
import { issueTownTicket, townSecret } from "@/server/town-ticket";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return apiResponse(async () => {
    assertSameOrigin(request);
    z.strictObject({ worldId: z.literal("main-world").default("main-world") }).parse(
      await readJson(request, 256),
    );
    const actor = requireActor(await currentActor());
    if (!process.env.TOWN_SIGNING_SECRET)
      throw new AppError("CONFLICT", "타운을 준비하고 있어요. 잠시 뒤 다시 방문해주세요.");
    await enforceRequestLimit(getDatabase(), actor, "town-ticket", 120, 3600);
    const world = await townInternal("/internal/world", {});
    return {
      roomId: world.roomId,
      worldId: "main-world",
      ticket: issueTownTicket(actor, townSecret()),
      path:
        process.env.NODE_ENV === "development"
          ? `ws://127.0.0.1:${Number(process.env.TOWN_PORT ?? 13003)}`
          : "/town-ws",
    };
  });
}
