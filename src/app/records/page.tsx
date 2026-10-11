import type { Metadata } from "next";
import { currentActor } from "@/server/identity";
import { RecordsList, RecordsLogin } from "@/components/event-records";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "행사 기록 | Sliper",
  description: "함께 만든 행사와 다음 즐거움을 위한 운영 기록",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ libraryId?: string }>;
}) {
  const params = await searchParams;
  return (await currentActor()) ? (
    <RecordsList {...(params.libraryId ? { libraryId: params.libraryId } : {})} />
  ) : (
    <RecordsLogin />
  );
}
