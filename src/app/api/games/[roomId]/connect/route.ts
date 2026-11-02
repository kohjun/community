import { apiResponse, assertSameOrigin, readJson } from "@/server/http";
import { gameService, gameContext } from "@/server/game-http";
import { z } from "zod";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  return apiResponse(async () => {
    assertSameOrigin(request);
    const { host } = z
      .object({ host: z.boolean().default(false) })
      .strict()
      .parse(await readJson(request, 256));
    const { roomId } = await params;
    return gameService().connect(roomId, await gameContext(request, roomId, host, true));
  });
}
