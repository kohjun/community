import { apiResponse, assertSameOrigin } from "@/server/http";
import { gameService, gameContext } from "@/server/game-http";
import { gameInkRedis } from "@/server/game-ink-runtime";
import { issueInkTicket } from "@/server/game-ink-core";
import { AppError } from "@/server/errors";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  return apiResponse(async () => {
    assertSameOrigin(request);
    const { roomId } = await params,
      who = await gameContext(
        request,
        roomId,
        new URL(request.url).searchParams.get("host") === "1",
      ),
      view = await gameService().read(roomId, who);
    if (
      !view.drawing ||
      view.phase !== "playing" ||
      (!view.isHost && view.viewer.status !== "admitted")
    )
      throw new AppError("FORBIDDEN", "진행 중인 그림 게임 참가자만 연결할 수 있어요.");
    const authority = await (await gameInkRedis()).store.authority(roomId),
      member = view.viewer.id ?? "host";
    if (!authority?.members[member])
      throw new AppError("CONFLICT", "그림 차례가 바뀌었어요. 다시 연결해주세요.");
    const ticket = issueInkTicket(
      { roomId, member, phaseId: authority.phaseId, expiresAt: Date.now() + 60000 },
      process.env.VISITOR_HASH_SECRET ?? "",
    );
    return {
      ticket,
      url:
        process.env.GAME_INK_PUBLIC_URL ??
        new URL("/ws/games", process.env.APP_ORIGIN ?? request.url).href.replace(/^http/, "ws"),
    };
  });
}
