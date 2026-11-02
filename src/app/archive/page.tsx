import { publicPageMetadata } from "@/domain/search-visibility";
import { ParticipationShell } from "@/components/participation-shell";
import { ArchiveHeading } from "@/components/archive-heading";
import { ArchiveNavigation } from "@/components/workspace-navigation";
import { RecordsList, RecordsLogin } from "@/components/record-list";
import { archiveRecordsHref } from "@/domain/workspace-navigation";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { libraryService } from "@/server/library-service";
import { LibraryList } from "@/components/library-list";
import {
  libraryFilterParams,
  libraryFiltersFromParams,
} from "@/components/library-discovery-query";
import { librarySearchParams, type LibraryListQuery } from "@/domain/library";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await currentActor(),
    incoming = await searchParams,
    params = new URLSearchParams();
  for (const [key, value] of Object.entries(incoming)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else if (value !== undefined) params.set(key, value);
  }
  if (incoming.tab === "records") {
    const libraryId = typeof incoming.libraryId === "string" ? incoming.libraryId : undefined;
    return (
      <ParticipationShell advertising={false}>
        <ArchiveHeading canWrite={!!actor} />
        <ArchiveNavigation active="records" />
        {actor ? (
          <RecordsList {...(libraryId ? { libraryId } : {})} embedded />
        ) : (
          <RecordsLogin returnTo={archiveRecordsHref(libraryId)} embedded />
        )}
      </ParticipationShell>
    );
  }
  params.delete("tab");
  let query: LibraryListQuery;
  let initialError = "";
  try {
    query = librarySearchParams(params);
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    query = librarySearchParams(new URLSearchParams());
    initialError = "검색 조건을 확인할 수 없어 전체 자료를 보여드려요. 조건을 다시 선택해주세요.";
  }
  if (!actor && (query.mine || query.used)) {
    redirect("/login?returnTo=" + encodeURIComponent("/archive?" + params));
  }
  const service = libraryService(getDatabase());
  let initial;
  try {
    initial = await service.list(actor, query);
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "VALIDATION" || !query.cursor) throw error;
    query = { ...query, cursor: undefined };
    initialError = "이 페이지 주소가 더 이상 유효하지 않아 첫 자료부터 보여드려요.";
    initial = await service.list(actor, query);
  }
  const normalizedParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) normalizedParams.set(key, String(value));
  }
  const initialQuery = libraryFiltersFromParams(normalizedParams);
  return (
    <LibraryList
      key={libraryFilterParams(initialQuery, query.cursor).toString()}
      initialQuery={initialQuery}
      initialError={initialError}
      initial={initial}
    />
  );
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const personal = Object.keys(params).some((key) =>
    ["mine", "used", "tab", "libraryId"].includes(key),
  );
  return publicPageMetadata("/archive", personal);
}
