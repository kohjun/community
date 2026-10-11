import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDatabase } from "@/db/client";
import { purchaseQuerySchema } from "@/domain/library-market";
import { currentActor } from "@/server/identity";
import { libraryMarketService } from "@/server/library-market-service";
import { AppError } from "@/server/errors";
import { LibraryMarketList, LibraryMarketUnavailable } from "@/components/library-market";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "구매와 판매 | Sliper",
  description: "나의 자료 구매·판매 확인 내역",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [actor, query] = await Promise.all([currentActor(), searchParams]);
  if (!actor) redirect("/login?returnTo=%2Farchive%2Fpurchases");
  const parsed = purchaseQuerySchema.safeParse(query);
  if (!parsed.success)
    return <LibraryMarketUnavailable message="목록의 구분과 페이지 번호를 확인해주세요." />;
  try {
    const initial = await libraryMarketService(getDatabase()).list(actor, parsed.data);
    return <LibraryMarketList initial={initial} scope={parsed.data.scope} />;
  } catch (cause) {
    if (cause instanceof AppError) {
      if (cause.code === "UNAUTHENTICATED") redirect("/login?returnTo=%2Farchive%2Fpurchases");
      if (cause.code === "FORBIDDEN" || cause.code === "NOT_FOUND")
        return <LibraryMarketUnavailable message={cause.message} />;
    }
    throw cause;
  }
}
