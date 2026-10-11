import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { playerService } from "@/server/player-service";
import { AppError } from "@/server/errors";
import { RecordsLogin } from "@/components/event-records";
import { PlayerProfile } from "@/components/player-profile";
import { z } from "zod";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  if (!z.uuid().safeParse(publicId).success) notFound();
  const actor = await currentActor();
  if (!actor) return <RecordsLogin returnTo={"/players/" + publicId} />;
  try {
    return (
      <PlayerProfile
        key={publicId}
        canAct={true}
        initial={await playerService(getDatabase()).profile(actor, publicId)}
      />
    );
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}
