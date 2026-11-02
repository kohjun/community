import { publicPageMetadata } from "@/domain/search-visibility";
import { communityQueries } from "@/server/community-queries";
import { redirect } from "next/navigation";
import { communityLocation } from "@/domain/community-location";
import { topicForSlug } from "@/domain/topics";
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
    true,
  );
  const composeTopic =
    typeof params.composeTopic === "string" ? topicForSlug(params.composeTopic) : null;
  const actor = await currentActor();
  if (
    !actor &&
    (composeTopic || initialQuery.view === "mine" || initialQuery.view === "bookmarks")
  ) {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => typeof value === "string") as [string, string][],
    ).toString();
    redirect("/login?returnTo=" + encodeURIComponent("/stories?" + query));
  }
  const service = communityService(getDatabase());
  const [feed, notifications] = await Promise.all([
    communityQueries(getDatabase()).feed(actor, initialQuery),
    service.inbox(actor),
  ]);
  return (
    <SliperCommunity
      key={JSON.stringify([initialQuery, composeTopic?.slug])}
      initialQuery={initialQuery}
      {...(composeTopic ? { initialComposeTopic: composeTopic.slug } : {})}
      initialView="stories"
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

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const personal = Object.keys(params).some(
    (key) =>
      ["mine", "bookmarks"].includes(String(params.view)) ||
      ["compose", "write", "post"].includes(key),
  );
  return publicPageMetadata("/stories", personal);
}
