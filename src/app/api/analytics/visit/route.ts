import { currentActor } from "@/server/identity";
import { getDatabase } from "@/db/client";
import { analyticsService } from "@/server/analytics-service";
import { apiResponse, assertSameOrigin, readJson } from "@/server/http";
import { z } from "zod";
export async function POST(request: Request) {
  return apiResponse(async () => {
    assertSameOrigin(request);
    z.strictObject({}).parse(await readJson(request));
    return analyticsService(getDatabase()).collect(await currentActor());
  });
}
