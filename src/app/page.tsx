import { redirect } from "next/navigation";
import { communityLocation } from "@/domain/community-location";
import { SliperCommunity } from "@/components/sliper-community";
import { getDatabase } from "@/db/client";
import { communityService } from "@/server/community-service";
import { currentActor } from "@/server/identity";
import { authConfiguration } from "@/server/auth-config";

export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const initialQuery = communityLocation(
    new URLSearchParams(
      Object.entries(params).filter(([, value]) => typeof value === "string") as [string, string][],
    ),
    false,
  );
  const actor = await currentActor();
  if (!actor && (initialQuery.view === "mine" || initialQuery.view === "bookmarks")) {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => typeof value === "string") as [string, string][],
    ).toString();
    redirect("/login?returnTo=" + encodeURIComponent("/?" + query));
  }
  const service = communityService(getDatabase());
  const [feed, notifications] = await Promise.all([
    service.feed(actor, initialQuery),
    service.inbox(actor),
  ]);
  return (
    <SliperCommunity
      key={JSON.stringify(initialQuery)}
      initialQuery={initialQuery}
      initialState={{
        ...feed,
        notifications: notifications.items,
        notificationNextCursor: notifications.nextCursor,
        unreadCount: notifications.unreadCount,
        canWrite: !!actor,
        mode: actor ? (authConfiguration() ? "authenticated" : "development") : "readonly",
      }}
    />
  );
}
