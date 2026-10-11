import { uploadVideo } from "@/server/video-media";
import { currentActor } from "@/server/identity";
import { apiResponse, assertSameOrigin } from "@/server/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  return apiResponse(async () => {
    assertSameOrigin(request);
    return uploadVideo(request, await currentActor());
  });
}
