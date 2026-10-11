import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { topicService } from "@/server/topic-service";
import { topicForSlug, topicQuerySchema } from "@/domain/topics";
import { TopicDetailView } from "@/components/topic-discovery";
export const dynamic = "force-dynamic";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const topic = topicForSlug((await params).slug);
  return {
    title: topic ? topic.title + " | Sliper" : "주제 탐색 | Sliper",
    description: topic?.description ?? "취향이 닮은 즐거움을 찾아보세요.",
    robots: { index: false, follow: false },
  };
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  if (!topicForSlug(slug)) notFound();
  const parsed = topicQuerySchema.safeParse(await searchParams);
  const data = await topicService(getDatabase()).detail(
    await currentActor(),
    slug,
    parsed.success ? parsed.data : {},
  );
  return <TopicDetailView data={data} invalidQuery={!parsed.success} />;
}
