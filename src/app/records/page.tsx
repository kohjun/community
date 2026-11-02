import { redirect } from "next/navigation";
import { archiveRecordsHref } from "@/domain/workspace-navigation";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ libraryId?: string }>;
}) {
  const params = await searchParams;
  redirect(archiveRecordsHref(params.libraryId));
}
