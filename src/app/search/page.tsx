import type { Metadata } from "next";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { searchService } from "@/server/search-service";
import { searchInputSchema } from "@/domain/search";
import { UnifiedSearch } from "@/components/unified-search";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "통합 검색 | Sliper",
  description: "이야기, 모집, 아카이브 자료와 행사 기록을 한곳에서 찾아보세요.",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = searchInputSchema.safeParse(params);
  const result = await searchService(getDatabase()).search(
    await currentActor(),
    query.success ? query.data : {},
  );
  return <UnifiedSearch data={result} invalidQuery={!query.success} />;
}
