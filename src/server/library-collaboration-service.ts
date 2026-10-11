import { previewTitleSql } from "./discussion-policy";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { posts, profiles } from "../db/schema";
import {
  libraryEntries,
  libraryVersions,
  librarySuggestions,
  libraryDiscussionLinks,
} from "../db/library-schema";
import { libraryInputSchema, type LibraryInput } from "../domain/library";
import {
  collaborationQuerySchema,
  discussionLinkSchema,
  suggestionInputSchema,
  suggestionDecisionSchema,
  type SuggestionSummary,
  type SuggestionDetail,
  type LibraryCollaborationPage,
  type DiscussionLink,
  type SuggestionField,
} from "../domain/library-collaboration";
import { uuidSchema } from "../domain/validation";
import { libraryService } from "./library-service";
import { requireRecordMember } from "./record-policy";
import { creditMemberVisible } from "./event-credit-service";
import { contentVisible } from "./safety-visibility";
import { preciseTimestamp } from "./pagination";
import { enforceRequestLimit } from "./request-limits";
import { AppError } from "./errors";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
const connection = (tx: Tx) => tx as unknown as Database;
export function libraryCollaborationService(db: Database) {
  async function source(tx: Tx, user: string, id: string) {
    const detail = await libraryService(connection(tx)).detail(user, uuidSchema.parse(id));
    if (detail.status !== "published")
      throw new AppError("NOT_FOUND", "발행된 자료만 협업할 수 있어요.");
    const [entry] = await tx
      .select()
      .from(libraryEntries)
      .where(eq(libraryEntries.id, id))
      .for("update");
    return { detail, entry: entry! };
  }
  function suggestionRows(
    tx: Tx,
    user: string,
    entryId: string,
    owner: boolean,
    suggestionId?: string,
  ) {
    return tx
      .select({
        suggestion: librarySuggestions,
        version: libraryVersions.number,
        nickname: profiles.nickname,
        updatedAt: preciseTimestamp(librarySuggestions.updatedAt),
        publishedVersion: sql<
          number | null
        >`(select number from sliper.library_versions pv where pv.id=${librarySuggestions.publishedVersionId})`,
      })
      .from(librarySuggestions)
      .innerJoin(libraryVersions, eq(libraryVersions.id, librarySuggestions.baseVersionId))
      .leftJoin(profiles, eq(profiles.id, librarySuggestions.proposerId))
      .where(
        and(
          eq(librarySuggestions.entryId, entryId),
          suggestionId ? eq(librarySuggestions.id, suggestionId) : undefined,
          owner
            ? sql`${librarySuggestions.proposerId} is not null and ${creditMemberVisible(user, librarySuggestions.proposerId)}`
            : eq(librarySuggestions.proposerId, user),
        ),
      );
  }
  type Row = Awaited<ReturnType<typeof suggestionRows>>[number];
  function summary(row: Row, user: string): SuggestionSummary {
    const s = row.suggestion;
    return {
      id: s.id,
      field: s.field as SuggestionField,
      baseVersion: row.version,
      status: s.status as SuggestionSummary["status"],
      proposer: row.nickname ?? "탈퇴한 회원",
      isMine: s.proposerId === user,
      updatedAt: row.updatedAt,
      createdAt: s.createdAt.toISOString(),
      publishedVersion: row.publishedVersion,
    };
  }
  async function discussions(tx: Tx, user: string, entryId: string): Promise<DiscussionLink[]> {
    const rows = await tx
      .select({
        postId: posts.id,
        title: previewTitleSql,
        category: posts.categorySlug,
        author: profiles.nickname,
        anonymous: posts.isAnonymous,
        authorId: posts.authorId,
        createdBy: libraryDiscussionLinks.createdBy,
        ownerId: libraryEntries.ownerId,
        version: libraryVersions.number,
      })
      .from(libraryDiscussionLinks)
      .innerJoin(posts, eq(posts.id, libraryDiscussionLinks.postId))
      .innerJoin(libraryVersions, eq(libraryVersions.id, libraryDiscussionLinks.versionId))
      .innerJoin(libraryEntries, eq(libraryEntries.id, libraryDiscussionLinks.entryId))
      .leftJoin(profiles, eq(profiles.id, posts.authorId))
      .where(
        and(
          eq(libraryDiscussionLinks.entryId, entryId),
          eq(posts.status, "published"),
          eq(posts.kind, "이야기"),
          sql`${posts.authorId} is not null`,
          sql`${posts.categorySlug}::text in ('knowledge','lab')`,
          contentVisible("post", posts.id),
          creditMemberVisible(user, posts.authorId),
        ),
      )
      .orderBy(desc(libraryDiscussionLinks.createdAt))
      .limit(50);
    return rows.map((r) => ({
      postId: r.postId,
      title: r.title,
      category: r.category as DiscussionLink["category"],
      author: r.anonymous ? "익명" : (r.author ?? "탈퇴한 회원"),
      version: r.version,
      canRemove: r.authorId === user || r.ownerId === user || r.createdBy === user,
    }));
  }
  async function list(
    actor: string | null,
    id: string,
    input: unknown = {},
  ): Promise<LibraryCollaborationPage> {
    const user = await requireRecordMember(db, actor),
      q = collaborationQuerySchema.parse(input);
    return db.transaction(async (tx) => {
      const { detail } = await source(tx, user, id),
        found = await suggestionRows(tx, user, id, detail.isMine)
          .orderBy(desc(librarySuggestions.createdAt), desc(librarySuggestions.id))
          .limit(20)
          .offset((q.page - 1) * 20);
      const [count] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(librarySuggestions)
        .where(
          and(
            eq(librarySuggestions.entryId, id),
            detail.isMine
              ? sql`${librarySuggestions.proposerId} is not null and ${creditMemberVisible(user, librarySuggestions.proposerId)}`
              : eq(librarySuggestions.proposerId, user),
          ),
        );
      const total = Number(count?.total ?? 0);
      return {
        items: found.map((r) => summary(r, user)),
        total,
        page: q.page,
        pageCount: Math.max(1, Math.ceil(total / 20)),
        discussions: await discussions(tx, user, id),
        isOwner: detail.isMine,
        canPropose: !detail.isMine && !!detail.payload,
      };
    });
  }
  async function detail(
    actor: string | null,
    id: string,
    suggestionId: string,
  ): Promise<SuggestionDetail> {
    const user = await requireRecordMember(db, actor);
    uuidSchema.parse(suggestionId);
    return db.transaction(async (tx) => {
      const { detail: entry } = await source(tx, user, id);
      const rows = await suggestionRows(tx, user, id, entry.isMine, suggestionId);
      const row = rows.find((r) => r.suggestion.id === suggestionId);
      if (!row) throw new AppError("NOT_FOUND", "수정 제안을 찾을 수 없어요.");
      const version = await libraryService(connection(tx)).version(user, id, row.version);
      if (!version.content) throw new AppError("FORBIDDEN", "해당 버전의 열람 권한이 필요해요.");
      const s = row.suggestion,
        stale = entry.publishedVersion !== row.version;
      return {
        ...summary(row, user),
        before: version.content[s.field as SuggestionField],
        replacement: s.replacement,
        reason: s.reason,
        decisionNote: s.decisionNote,
        stale,
        canApprove: entry.isMine && s.status === "pending" && !stale && !entry.draftContent,
        canWithdraw: s.proposerId === user && s.status === "pending",
      };
    });
  }
  async function propose(actor: string | null, id: string, input: unknown) {
    const user = await requireRecordMember(db, actor),
      v = suggestionInputSchema.parse(input);
    await enforceRequestLimit(db, user, "library_suggestion", 10);
    const suggestionId = await db.transaction(async (tx) => {
      const { detail: entry } = await source(tx, user, id);
      if (entry.isMine) throw new AppError("VALIDATION", "내 자료는 자료 편집에서 수정해주세요.");
      if (entry.publishedVersion !== v.version)
        throw new AppError("CONFLICT", "최신 버전을 기준으로 다시 제안해주세요.");
      const version = await libraryService(connection(tx)).version(user, id, v.version);
      if (!version.content) throw new AppError("FORBIDDEN", "자료 열람 권한을 확인해주세요.");
      const content = libraryInputSchema.parse({ ...version.content, [v.field]: v.replacement });
      if (content[v.field] === version.content[v.field])
        throw new AppError("VALIDATION", "원본과 다른 수정 내용을 작성해주세요.");
      const [base] = await tx
        .select({ id: libraryVersions.id })
        .from(libraryVersions)
        .where(and(eq(libraryVersions.entryId, id), eq(libraryVersions.number, v.version)));
      const [existing] = await tx
        .select({ id: librarySuggestions.id })
        .from(librarySuggestions)
        .where(
          and(
            eq(librarySuggestions.entryId, id),
            eq(librarySuggestions.baseVersionId, base!.id),
            eq(librarySuggestions.proposerId, user),
            eq(librarySuggestions.field, v.field),
            eq(librarySuggestions.status, "pending"),
          ),
        );
      if (existing)
        throw new AppError("CONFLICT", "같은 항목에 검토 중인 제안이 있어요. 먼저 철회해주세요.");
      const [created] = await tx
        .insert(librarySuggestions)
        .values({
          entryId: id,
          baseVersionId: base!.id,
          proposerId: user,
          field: v.field,
          replacement: v.replacement,
          reason: v.reason,
        })
        .returning({ id: librarySuggestions.id });
      return created!.id;
    });
    return detail(user, id, suggestionId);
  }
  async function decide(actor: string | null, id: string, suggestionId: string, input: unknown) {
    const user = await requireRecordMember(db, actor),
      v = suggestionDecisionSchema.parse(input);
    uuidSchema.parse(suggestionId);
    await db.transaction(async (tx) => {
      const { detail: entry } = await source(tx, user, id);
      const [s] = await tx
        .select({ row: librarySuggestions, at: preciseTimestamp(librarySuggestions.updatedAt) })
        .from(librarySuggestions)
        .where(and(eq(librarySuggestions.id, suggestionId), eq(librarySuggestions.entryId, id)))
        .for("update");
      if (
        !s ||
        !s.row.proposerId ||
        !(await suggestionRows(tx, user, id, entry.isMine, suggestionId)).some(
          (r) => r.suggestion.id === suggestionId,
        )
      )
        throw new AppError("NOT_FOUND", "수정 제안을 찾을 수 없어요.");
      if (s.at !== v.expectedUpdatedAt || s.row.status !== "pending")
        throw new AppError("CONFLICT", "이미 처리되거나 변경된 제안이에요.");
      if (v.decision === "withdraw" ? s.row.proposerId !== user : !entry.isMine)
        throw new AppError("FORBIDDEN", "제안 처리 권한이 없어요.");
      let publishedVersionId: string | null = null;
      if (v.decision === "approve") {
        const [base] = await tx
          .select()
          .from(libraryVersions)
          .where(eq(libraryVersions.id, s.row.baseVersionId));
        if (base!.number !== entry.publishedVersion || entry.draftContent)
          throw new AppError(
            "CONFLICT",
            "기준 버전이 바뀌었거나 작성 중인 초안이 있어요. 먼저 정리해주세요.",
          );
        const content = libraryInputSchema.parse({
          ...base!.content,
          [s.row.field]: s.row.replacement,
        }) as LibraryInput;
        const service = libraryService(connection(tx));
        const saved = await service.saveDraft(user, id, {
          content,
          expectedUpdatedAt: v.expectedLibraryUpdatedAt,
        });
        const released = await service.publish(user, id, {
          expectedUpdatedAt: saved.updatedAt,
          changeSummary: v.note,
          publicContentConsent: v.publicContentConsent,
        });
        const [version] = await tx
          .select({ id: libraryVersions.id })
          .from(libraryVersions)
          .where(
            and(
              eq(libraryVersions.entryId, id),
              eq(libraryVersions.number, released.publishedVersion),
            ),
          );
        publishedVersionId = version!.id;
      }
      await tx
        .update(librarySuggestions)
        .set({
          status:
            v.decision === "approve"
              ? "approved"
              : v.decision === "reject"
                ? "rejected"
                : "withdrawn",
          decisionNote: v.note,
          decidedBy: user,
          decidedAt: sql`clock_timestamp()`,
          publishedVersionId,
          updatedAt: sql`greatest(clock_timestamp(),${librarySuggestions.updatedAt}+interval '1 microsecond')`,
        })
        .where(eq(librarySuggestions.id, suggestionId));
    });
    return list(user, id);
  }
  async function link(actor: string | null, id: string, input: unknown, remove = false) {
    const user = await requireRecordMember(db, actor),
      v = discussionLinkSchema.parse(input);
    await enforceRequestLimit(db, user, "library_discussion", 30);
    await db.transaction(async (tx) => {
      const { detail: entry } = await source(tx, user, id);
      const version = await libraryService(connection(tx)).version(user, id, v.version);
      if (!version.content) throw new AppError("FORBIDDEN", "자료 열람 권한을 확인해주세요.");
      const [post] = await tx
        .select()
        .from(posts)
        .where(
          and(
            eq(posts.id, v.postId),
            eq(posts.status, "published"),
            eq(posts.kind, "이야기"),
            sql`${posts.authorId} is not null`,
            sql`${posts.categorySlug}::text in ('knowledge','lab')`,
            contentVisible("post", posts.id),
            creditMemberVisible(user, posts.authorId),
          ),
        );
      if (!post) throw new AppError("NOT_FOUND", "공개된 지식·콘텐츠 연구 글만 연결할 수 있어요.");
      const [base] = await tx
        .select({ id: libraryVersions.id })
        .from(libraryVersions)
        .where(and(eq(libraryVersions.entryId, id), eq(libraryVersions.number, v.version)));
      const condition = and(
        eq(libraryDiscussionLinks.entryId, id),
        eq(libraryDiscussionLinks.postId, v.postId),
        eq(libraryDiscussionLinks.versionId, base!.id),
      );
      const [prior] = await tx.select().from(libraryDiscussionLinks).where(condition);
      if (!entry.isMine && post.authorId !== user && !(remove && prior?.createdBy === user))
        throw new AppError(
          "FORBIDDEN",
          "자료 작성자 또는 이야기 작성자만 연결을 관리할 수 있어요.",
        );
      if (remove) await tx.delete(libraryDiscussionLinks).where(condition);
      else
        await tx
          .insert(libraryDiscussionLinks)
          .values({ entryId: id, postId: v.postId, versionId: base!.id, createdBy: user })
          .onConflictDoNothing();
    });
    return list(user, id);
  }
  async function postLinks(actor: string | null, postId: string) {
    const user = await requireRecordMember(db, actor);
    uuidSchema.parse(postId);
    const [post] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(
        and(
          eq(posts.id, postId),
          eq(posts.status, "published"),
          eq(posts.kind, "이야기"),
          sql`${posts.authorId} is not null and ${posts.categorySlug}::text in ('knowledge','lab')`,
          contentVisible("post", posts.id),
          creditMemberVisible(user, posts.authorId),
        ),
      );
    if (!post) throw new AppError("NOT_FOUND", "이야기를 찾을 수 없어요.");
    return db
      .select({
        id: libraryEntries.id,
        title: libraryEntries.title,
        kind: libraryEntries.kind,
        version: libraryVersions.number,
      })
      .from(libraryDiscussionLinks)
      .innerJoin(libraryEntries, eq(libraryEntries.id, libraryDiscussionLinks.entryId))
      .innerJoin(libraryVersions, eq(libraryVersions.id, libraryDiscussionLinks.versionId))
      .where(
        and(
          eq(libraryDiscussionLinks.postId, postId),
          eq(libraryEntries.status, "published"),
          sql`${libraryEntries.ownerId} is not null`,
          contentVisible("library", libraryEntries.id),
          creditMemberVisible(user, libraryEntries.ownerId),
        ),
      )
      .limit(50);
  }
  return { list, detail, propose, decide, link, postLinks };
}
