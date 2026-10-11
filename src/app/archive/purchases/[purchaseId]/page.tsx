import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getDatabase } from "@/db/client";
import { uuidSchema } from "@/domain/validation";
import { currentActor } from "@/server/identity";
import { libraryMarketService } from "@/server/library-market-service";
import { AppError } from "@/server/errors";
import { LibraryMarketDetail, LibraryMarketUnavailable } from "@/components/library-market";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "자료 구매 내역 | Sliper",
  description: "자료 구매 버전과 이용 조건, 확인 내역",
  robots: { index: false, follow: false },
};
export default async function Page({ params }: { params: Promise<{ purchaseId: string }> }) {
  const [{ purchaseId }, actor] = await Promise.all([params, currentActor()]);
  if (!uuidSchema.safeParse(purchaseId).success) notFound();
  const returnTo = encodeURIComponent(`/archive/purchases/${purchaseId}`);
  if (!actor) redirect(`/login?returnTo=${returnTo}`);
  try {
    const initial = await libraryMarketService(getDatabase()).detail(actor, purchaseId);
    return <LibraryMarketDetail initial={initial} />;
  } catch (cause) {
    if (cause instanceof AppError) {
      if (cause.code === "NOT_FOUND") notFound();
      if (cause.code === "UNAUTHENTICATED") redirect(`/login?returnTo=${returnTo}`);
      if (cause.code === "FORBIDDEN") return <LibraryMarketUnavailable message={cause.message} />;
    }
    throw cause;
  }
}
