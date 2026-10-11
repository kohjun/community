import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { libraryService } from "@/server/library-service";
import { localLibraryPurchaseEnabled } from "@/server/library-test-purchase";
import { AppError } from "@/server/errors";
import { LibraryDetail } from "@/components/library-detail";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params,
    actor = await currentActor();
  try {
    const initial = await libraryService(getDatabase()).detail(actor, id);
    return (
      <LibraryDetail
        key={id}
        initial={initial}
        authenticated={!!actor}
        localTestPurchase={localLibraryPurchaseEnabled()}
      />
    );
  } catch (e) {
    if (e instanceof ZodError || (e instanceof AppError && e.code === "NOT_FOUND")) notFound();
    throw e;
  }
}
