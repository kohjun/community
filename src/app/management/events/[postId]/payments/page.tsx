import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { paymentReconciliationService } from "@/server/payment-reconciliation-service";
import { ParticipationLogin, ParticipationShell } from "@/components/participation-shell";
import { PaymentReconciliationPanel } from "@/components/payment-reconciliation";
import { AppError } from "@/server/errors";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ postId: string }> }) {
  const actor = await currentActor();
  if (!actor) return <ParticipationLogin />;
  const { postId } = await params;
  try {
    return (
      <PaymentReconciliationPanel
        key={postId}
        initial={await paymentReconciliationService(getDatabase()).overview(actor, postId)}
      />
    );
  } catch (cause) {
    if (cause instanceof AppError)
      return (
        <ParticipationShell>
          <p className="participation-error">{cause.message}</p>
        </ParticipationShell>
      );
    throw cause;
  }
}
