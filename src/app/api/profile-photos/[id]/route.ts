import { z } from "zod";
import { uuidSchema } from "@/domain/validation";
import { readProfilePhoto } from "@/server/profile-photos";
import { currentActor } from "@/server/identity";
import { apiResponse } from "@/server/http";
import { AppError } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const querySchema = z.strictObject({ room: uuidSchema.optional() });
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const params = new URL(request.url).searchParams;
    if (params.getAll("room").length > 1)
      throw new AppError("VALIDATION", "공지방 정보를 확인해주세요.");
    const query = querySchema.parse(Object.fromEntries(params));
    return await readProfilePhoto((await context.params).id, await currentActor(), query.room);
  } catch (error) {
    return apiResponse(async () => {
      throw error;
    });
  }
}
