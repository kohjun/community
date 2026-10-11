import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { eventRecords, posts } from "../db/schema";
import { libraryEntries } from "../db/library-schema";
import { eventRecordLinks } from "../db/records-schema";
import { libraryInputSchema, type LibraryInput } from "../domain/library";
import { recordTemplateDraftSchema } from "../domain/records";
import { uuidSchema } from "../domain/validation";
import { AppError } from "./errors";
import { libraryService } from "./library-service";
import { recordVisible, requireRecordMember } from "./record-policy";

export function createRecordTemplateService(db: Database) {
  async function createDraft(actor: string | null, rawPostId: string, input: unknown) {
    const postId = uuidSchema.parse(rawPostId),
      value = recordTemplateDraftSchema.parse(input);
    const user = await requireRecordMember(db, actor);
    return db.transaction(async (tx) => {
      // Match record editing's lock order so concurrent conversions reuse one draft.
      const [post] = await tx
        .select({ authorId: posts.authorId })
        .from(posts)
        .where(eq(posts.id, postId))
        .for("update");
      const [record] = await tx
        .select({
          ownerId: eventRecords.ownerId,
          snapshot: eventRecords.snapshot,
          purpose: eventRecords.purpose,
          execution: eventRecords.execution,
          highlights: eventRecords.highlights,
          improvements: eventRecords.improvements,
        })
        .from(eventRecords)
        .where(and(eq(eventRecords.postId, postId), recordVisible(user, true)))
        .for("update");
      if (!post || !record) throw new AppError("NOT_FOUND", "행사 기록을 찾을 수 없어요.");
      if (record.ownerId !== user || post.authorId !== user)
        throw new AppError("FORBIDDEN", "주최자만 자신의 회고를 템플릿 초안으로 만들 수 있어요.");
      const [same] = await tx
        .select({ id: eventRecords.postId })
        .from(eventRecords)
        .where(
          and(
            eq(eventRecords.postId, postId),
            sql`${eventRecords.updatedAt}=${value.expectedUpdatedAt}::timestamptz`,
          ),
        );
      if (!same)
        throw new AppError(
          "CONFLICT",
          "회고가 수정되었어요. 최신 내용을 불러온 뒤 다시 시도해주세요.",
        );
      const library = libraryService(tx as unknown as Database);
      const [existing] = await tx
        .select({ id: libraryEntries.id })
        .from(libraryEntries)
        .where(
          and(
            eq(libraryEntries.ownerId, user),
            eq(libraryEntries.sourceRecordPostId, postId),
            sql`${libraryEntries.status} <> 'deleted'`,
          ),
        );
      if (existing) return library.detail(user, existing.id);
      if (record.purpose.trim().length < 10 || record.execution.trim().length < 10)
        throw new AppError(
          "VALIDATION",
          "기획 의도와 실제 진행을 각각 10자 이상 저장한 뒤 템플릿으로 만들어주세요.",
        );
      const start = record.snapshot.startsAt ? new Date(record.snapshot.startsAt).getTime() : NaN;
      const end = record.snapshot.endsAt ? new Date(record.snapshot.endsAt).getTime() : NaN;
      const duration = Number.isFinite(end - start)
        ? Math.max(5, Math.min(1440, Math.round((end - start) / 60000)))
        : 60;
      // Only the host's own reflection fields cross this boundary. Record documents,
      // participant data and member-only photos/videos are deliberately never read.
      const content: LibraryInput = libraryInputSchema.parse({
        kind: "template",
        categorySlug: record.snapshot.category,
        title: (record.snapshot.title + " 운영 템플릿").slice(0, 120),
        summary: record.purpose.trim().slice(0, 600),
        scenario: "## 기획 의도\n" + record.purpose + "\n\n## 실제 진행\n" + record.execution,
        rules: record.execution,
        hostGuide:
          "## 잘된 점\n" +
          (record.highlights || "운영 중 잘된 점을 보완해주세요.") +
          "\n\n## 개선점\n" +
          (record.improvements || "다음 운영에서 개선할 점을 보완해주세요.") +
          "\n\n인원·진행시간·준비물과 이용 조건을 발행 전에 확인해주세요.",
        materials: [],
        minPlayers: 1,
        maxPlayers: 20,
        durationMinutes: duration,
        rounds: [{ name: "전체 진행", seconds: duration * 60 }],
        tags: [],
        priceKRW: 0,
        purchaseUrl: null,
        usageTerms: "작성자의 이용 조건을 확인해주세요.",
        allowDerivatives: false,
        allowCommercialUse: false,
      });
      const draft = await library.createDraft(user, content, { sourceRecordPostId: postId });
      await tx
        .insert(eventRecordLinks)
        .values({ recordPostId: postId, libraryEntryId: draft.id })
        .onConflictDoNothing();
      return draft;
    });
  }
  return { createDraft };
}
