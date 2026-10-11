import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { currentActor } from "@/server/identity";
import { RecordDetailPage, RecordsLogin } from "@/components/event-records";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "행사 기록 | Sliper",
  description: "Sliper 회원이 함께 만든 행사 기록",
  robots: { index: false, follow: false },
};
export default async function Page({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  if (!z.uuid().safeParse(postId).success) notFound();
  return (await currentActor()) ? (
    <RecordDetailPage postId={postId} />
  ) : (
    <RecordsLogin returnTo={"/records/" + postId} />
  );
}
