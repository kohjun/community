import { apiResponse, assertSameOrigin, readJson } from "@/server/http";
import { gameService, gameContext } from "@/server/game-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ roomId: string }> };
export async function GET(request: Request, { params }: Context) {
  return apiResponse(async () => {
    const { roomId } = await params;
    return gameService().read(
      roomId,
      await gameContext(request, roomId, new URL(request.url).searchParams.get("host") === "1"),
    );
  });
}
export async function PATCH(request: Request, { params }: Context) {
  return apiResponse(async () => {
    assertSameOrigin(request);
    const { roomId } = await params;
    const host = new URL(request.url).searchParams.get("host") === "1";
    const who = await gameContext(request, roomId, host);
    const body = await readJson(request, 2048);
    return host ? gameService().host(roomId, who, body) : gameService().player(roomId, who, body);
  });
}
