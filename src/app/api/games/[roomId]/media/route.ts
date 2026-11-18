import { apiResponse, assertSameOrigin } from "@/server/http";
import { gameContext } from "@/server/game-http";
import { uploadGameAsset } from "@/server/game-media";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  return apiResponse(async () => {
    assertSameOrigin(request);
    const { roomId } = await params;
    return uploadGameAsset(
      request,
      roomId,
      await gameContext(request, roomId, new URL(request.url).searchParams.get("host") === "1"),
    );
  });
}
