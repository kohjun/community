import { getDatabase } from "@/db/client";
import { FALLBACK_SEARCH_SUGGESTIONS } from "@/domain/search-trends";
import { searchTrendsService } from "@/server/search-trends-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = {
  "Cache-Control": "public, max-age=120, stale-while-revalidate=300",
  "Content-Type": "application/json; charset=utf-8",
};

export async function GET() {
  try {
    const data = await searchTrendsService(getDatabase()).suggestions();
    return Response.json({ ok: true, data }, { headers });
  } catch {
    return Response.json({ ok: true, data: FALLBACK_SEARCH_SUGGESTIONS }, { headers });
  }
}
