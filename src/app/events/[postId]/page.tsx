import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { participationService } from "@/server/participation-service";
import { localPaymentTesting, paymentMode } from "@/server/payment-gateway";
import { AppError } from "@/server/errors";
import { ExternalEvent } from "@/components/external-event";
import { EventApplication } from "@/components/event-application";
import { PostReadTracker } from "@/components/post-read-tracker";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params,
    actor = await currentActor();
  try {
    const event = await participationService(getDatabase()).overview(actor, postId);
    return (
      <>
        <PostReadTracker postId={event.postId} />
        {event.externalUrl ? (
          <ExternalEvent key={event.postId} initial={event} />
        ) : (
          <EventApplication
            key={event.postId}
            initial={event}
            paymentMode={paymentMode(localPaymentTesting(actor))}
          />
        )}
      </>
    );
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
