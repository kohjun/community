import { apiResponse } from "@/server/http";
import { gameContext } from "@/server/game-http";
import { readGameAsset } from "@/server/game-media";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ roomId: string; assetId: string }> },
) {
  try {
    const { roomId, assetId } = await params;
    return await readGameAsset(
      request,
      roomId,
      assetId,
      await gameContext(request, roomId, new URL(request.url).searchParams.get("host") === "1"),
    );
  } catch (error) {
    return apiResponse(async () => {
      throw error;
    });
  }
}
export const HEAD = GET;
