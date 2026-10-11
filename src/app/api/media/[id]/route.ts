import { readImage } from "@/server/media";
import { currentActor } from "@/server/identity";
import { apiResponse } from "@/server/http";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return await readImage((await context.params).id, await currentActor());
  } catch (error) {
    return apiResponse(async () => {
      throw error;
    });
  }
}
