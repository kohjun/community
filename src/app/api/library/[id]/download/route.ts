import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { libraryService } from "@/server/library-service";
import { apiResponse } from "@/server/http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const result = await apiResponse(async () => {
    const { id } = await context.params;
    const file = await libraryService(getDatabase()).download(await currentActor(), id);
    return { id, markdown: file.markdown };
  });
  if (!result.ok) return result;
  const { data } = (await result.json()) as { data: { id: string; markdown: string } };
  return new Response(data.markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="sliper-rulebook-${data.id}.md"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
