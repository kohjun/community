import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import { placeHistoryQuerySchema } from "@/domain/place-history";
import { currentActor } from "@/server/identity";
import { createPlaceHistoryService } from "@/server/place-history-service";
import { AppError } from "@/server/errors";
import {
  PlaceHistory,
  PlaceHistoryLogin,
  PlaceHistoryUnavailable,
} from "@/components/place-history";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "장소의 행사 기록 | Sliper",
  description: "Sliper 회원이 공유한 장소의 완료 행사와 운영 팁",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, actor, search] = await Promise.all([params, currentActor(), searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  if (!actor) return <PlaceHistoryLogin placeId={id} />;
  const scalar = (value: string | string[] | undefined) =>
    typeof value === "string" ? value : undefined;
  const parsed = placeHistoryQuerySchema.safeParse({
    q: scalar(search.q),
    category: scalar(search.category) || undefined,
    tab: scalar(search.tab),
    page: scalar(search.page),
  });
  const filters = parsed.success ? parsed.data : placeHistoryQuerySchema.parse({});
  try {
    const initial = await createPlaceHistoryService(getDatabase()).history(actor, id, filters);
    return (
      <PlaceHistory
        key={`${id}:${filters.tab}:${filters.page}:${filters.category ?? ""}:${filters.q}`}
        initial={initial}
        initialFilters={filters}
      />
    );
  } catch (cause) {
    if (cause instanceof AppError) {
      if (cause.code === "NOT_FOUND") notFound();
      if (cause.code === "UNAUTHENTICATED") return <PlaceHistoryLogin placeId={id} />;
      if (cause.code === "FORBIDDEN") return <PlaceHistoryUnavailable message={cause.message} />;
    }
    throw cause;
  }
}
