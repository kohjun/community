import { readVideoJob } from "@/server/video-media";
import { currentActor } from "@/server/identity";
import { apiResponse } from "@/server/http";
export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return apiResponse(async () => readVideoJob((await context.params).id, await currentActor()));
}
