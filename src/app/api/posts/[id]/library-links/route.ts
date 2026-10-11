import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { apiResponse } from "@/server/http";
import { libraryCollaborationService } from "@/server/library-collaboration-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(_request: Request, context: { params: Promise<{ id: string }> }) {
  return apiResponse(async () =>
    libraryCollaborationService(getDatabase()).postLinks(
      await currentActor(),
      (await context.params).id,
    ),
  );
}
export { handle as GET, handle as HEAD };
