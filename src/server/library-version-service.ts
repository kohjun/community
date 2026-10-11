import { and, eq } from "drizzle-orm";
import type { Database } from "../db/connection";
import { AppError } from "./errors";
import { libraryVersions, libraryEntries } from "../db/library-schema";
import {
  libraryInputSchema,
  type LibraryInput,
  type LibraryPayload,
  type LibraryVersionSummary,
} from "../domain/library";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type LibraryEntry = typeof libraryEntries.$inferSelect;
export type LibraryVersion = typeof libraryVersions.$inferSelect;
export function libraryContent(entry: LibraryEntry): LibraryInput {
  return libraryInputSchema.parse({
    kind: entry.kind,
    categorySlug: entry.categorySlug,
    title: entry.title,
    summary: entry.summary,
    ...(entry.discoveryMetadata ? { discoveryMetadata: entry.discoveryMetadata } : {}),
    ...(entry.eventPlan ? { eventPlan: entry.eventPlan } : {}),
    scenario: entry.scenario,
    rules: entry.rules,
    hostGuide: entry.hostGuide,
    materials: entry.materials,
    rounds: entry.rounds,
    tags: entry.tags,
    minPlayers: entry.minPlayers,
    maxPlayers: entry.maxPlayers,
    durationMinutes: entry.durationMinutes,
    priceKRW: entry.priceKRW,
    purchaseUrl: entry.purchaseUrl,
    usageTerms: entry.usageTerms,
    allowDerivatives: entry.allowDerivatives,
    allowCommercialUse: entry.allowCommercialUse,
  });
}
export const libraryVersionPayload = (content: LibraryInput): LibraryPayload => ({
  ...(content.eventPlan ? { eventPlan: content.eventPlan } : {}),
  scenario: content.scenario,
  rules: content.rules,
  hostGuide: content.hostGuide,
  materials: content.materials,
  rounds: content.rounds,
});
export function libraryVersionSummary(row: LibraryVersion): LibraryVersionSummary {
  const c = libraryInputSchema.parse(row.content);
  return {
    id: row.id,
    entryId: row.entryId,
    number: row.number,
    title: c.title,
    summary: c.summary,
    discoveryMetadata: c.discoveryMetadata ?? null,
    kind: c.kind,
    category: c.categorySlug,
    priceKRW: c.priceKRW,
    publishedAt: row.publishedAt.toISOString(),
    changeSummary: row.changeSummary,
    legacy: row.legacy,
    usageTerms: c.usageTerms,
    allowDerivatives: c.allowDerivatives,
    allowCommercialUse: c.allowCommercialUse,
    sourceVersionId: row.sourceVersionId,
    sourceRecordPostId: row.sourceRecordPostId,
    sourceVersion: null,
  };
}
// Baselines describe the stored public edition, never an earlier event snapshot.
export async function ensurePublishedLibraryVersion(tx: Tx, entry: LibraryEntry) {
  if (entry.status !== "published")
    throw new AppError("NOT_FOUND", "발행된 자료를 찾을 수 없어요.");
  if (entry.publishedVersion) {
    const [version] = await tx
      .select()
      .from(libraryVersions)
      .where(
        and(
          eq(libraryVersions.entryId, entry.id),
          eq(libraryVersions.number, entry.publishedVersion),
        ),
      );
    if (!version) throw new AppError("CONFLICT", "발행 버전을 확인할 수 없어요.");
    return version;
  }
  const [version] = await tx
    .insert(libraryVersions)
    .values({
      entryId: entry.id,
      number: 1,
      content: libraryContent(entry),
      changeSummary: "버전 관리 도입 이전 자료",
      publisherId: entry.ownerId,
      legacy: true,
      sourceVersionId: entry.sourceVersionId,
      sourceRecordPostId: entry.sourceRecordPostId,
    })
    .returning();
  await tx
    .update(libraryEntries)
    .set({ publishedVersion: 1 })
    .where(eq(libraryEntries.id, entry.id));
  return version!;
}
export async function appendLibraryVersion(
  tx: Tx,
  entry: LibraryEntry,
  content: LibraryInput,
  publisherId: string,
  changeSummary: string,
) {
  const previous =
    entry.status === "published"
      ? (await ensurePublishedLibraryVersion(tx, entry)).number
      : entry.publishedVersion;
  const number = previous + 1;
  const [version] = await tx
    .insert(libraryVersions)
    .values({
      entryId: entry.id,
      number,
      content,
      publisherId,
      changeSummary,
      sourceVersionId: entry.sourceVersionId,
      sourceRecordPostId: entry.sourceRecordPostId,
    })
    .returning();
  return version!;
}
