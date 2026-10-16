import { redirect } from "next/navigation";
import { communityLocation } from "@/domain/community-location";
import { topicForSlug } from "@/domain/topics";
import type { Metadata } from "next";
import { SliperCommunity } from "@/components/sliper-community";
import { getDatabase } from "@/db/client";
import { communityService } from "@/server/community-service";
import { currentActor } from "@/server/identity";
import { authConfiguration } from "@/server/auth-config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "이야기 · 자유게시판 — Sliper",
  description: "예능과 일상의 이야기를 편하게 나누는 슬리퍼 자유게시판",
};
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
    service.feed(actor, initialQuery),
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
