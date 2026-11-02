import { apiResponse, assertSameOrigin } from "@/server/http";
import { currentActor } from "@/server/identity";
import { AppError, requireActor } from "@/server/errors";
import { townVoiceConfig, issueTownVoiceToken } from "@/server/town-voice";
import { townInternal } from "@/server/town-internal";
import { getDatabase } from "@/db/client";
import { enforceRequestLimit } from "@/server/request-limits";
export const runtime = "nodejs";
export async function GET() {
  return apiResponse(async () => {
    requireActor(await currentActor());
    return { enabled: !!townVoiceConfig() };
  });
}
export async function POST(request: Request) {
  return apiResponse(async () => {
    assertSameOrigin(request);
    const actor = requireActor(await currentActor()),
      config = townVoiceConfig();
    if (!config)
      throw new AppError(
        "CONFLICT",
        "근접 음성은 서버 연결을 준비하고 있어요. 지금은 광장 채팅을 이용해주세요.",
      );
    await enforceRequestLimit(getDatabase(), actor, "town-voice", 30);
    const session = await townInternal("/internal/session", { actor });
    return issueTownVoiceToken(session.identity, config);
  });
}
