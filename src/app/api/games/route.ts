import { apiResponse, assertSameOrigin, readJson } from "@/server/http";
import { gameService, gameContext, gameHost } from "@/server/game-http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return apiResponse(async () => {
    assertSameOrigin(request);
    const actor = await gameHost();
    const room = await gameService().create(actor, await readJson(request, 2048));
    await gameContext(request, room.id, false, true);
    return room;
  });
}

export async function GET() {
  return apiResponse(async () => gameService().mine(await gameHost()));
}
