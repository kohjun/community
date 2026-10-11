import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { apiResponse, assertSameOrigin, readJson } from "@/server/http";
import { lightningService } from "@/server/lightning-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return apiResponse(async () => {
    assertSameOrigin(request);
    return lightningService(getDatabase()).create(await currentActor(), await readJson(request));
  });
}
