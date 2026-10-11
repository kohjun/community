import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { EventCheckIn } from "@/components/event-check-in";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "행사 입장 확인 · Sliper", referrer: "no-referrer" };
export default async function Page({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  if (!z.uuid().safeParse(postId).success) notFound();
  return <EventCheckIn key={postId} postId={postId} />;
}
