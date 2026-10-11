import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { AppError } from "@/server/errors";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { libraryService } from "@/server/library-service";
import { LibraryEditor } from "@/components/library-editor";
import { ParticipationLogin } from "@/components/participation-shell";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  if (!actor) return <ParticipationLogin />;
  try {
    const { id } = await params,
      initial = await libraryService(getDatabase()).detail(actor, id);
    if (!initial.isMine) notFound();
    return <LibraryEditor key={id} kind={initial.kind} initial={initial} />;
  } catch (error) {
    if (error instanceof ZodError || (error instanceof AppError && error.code === "NOT_FOUND"))
      notFound();
    throw error;
  }
}
