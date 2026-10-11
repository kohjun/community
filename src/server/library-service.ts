import { and, desc, eq, gte, gt, ilike, lte, or, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { eventSettings, posts, profiles, roomManagers } from "../db/schema";
import {
  libraryEntries,
  libraryAccessRequests,
  templateProvenance,
  libraryVersions,
  libraryPurchases,
} from "../db/library-schema";
import {
  libraryInputSchema,
  libraryUpdateSchema,
  libraryPublishSchema,
  libraryVersionQuerySchema,
  libraryDeriveSchema,
  libraryListSchema,
  libraryAccessSchema,
  libraryDecisionSchema,
  templateHostSchema,
  type LibraryInput,
  type LibraryVersionDetail,
  type LibraryVersionPage,
  type LibrarySummary,
  type LibraryDetail,
  type LibraryPage,
  type LibraryPayload,
  type LibraryKind,
  type LibraryAccess,
  type LibraryAccessPage,
  type TemplateSnapshot,
} from "../domain/library";
import { uuidSchema } from "../domain/validation";
import { eventPlanMarkdown } from "../domain/event-plan";
import { assertContentVisible, contentVisible } from "./safety-visibility";
import { creditMemberVisible } from "./event-credit-service";
import {
  appendLibraryVersion,
  ensurePublishedLibraryVersion,
  libraryVersionSummary,
  libraryVersionPayload,
} from "./library-version-service";
import { requireRecordMember, visibleRecordSource } from "./record-policy";
import { AppError, requireActor } from "./errors";
import { bindEventVenue } from "./event-venue-service";
import {
  afterPosition,
  decodeCursor,
  encodeCursor,
  pageScope,
  preciseTimestamp,
} from "./pagination";
import { visibleLibraryUseCases } from "./library-discovery";

function preserveDiscoveryMetadata(content: LibraryInput, entry: Entry): LibraryInput {
  if (content.discoveryMetadata === undefined && entry.discoveryMetadata === null) return content;
  return {
    ...content,
    discoveryMetadata:
      content.discoveryMetadata === undefined ? entry.discoveryMetadata : content.discoveryMetadata,
  };
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Entry = typeof libraryEntries.$inferSelect;
const payload = (entry: Entry): LibraryPayload => ({
  ...(entry.eventPlan ? { eventPlan: entry.eventPlan } : {}),
  scenario: entry.scenario,
  rules: entry.rules,
  materials: entry.materials,
  hostGuide: entry.hostGuide,
  rounds: entry.rounds,
});
const accessView = (row: typeof libraryAccessRequests.$inferSelect): LibraryAccess => ({
  status: row.status as LibraryAccess["status"],
  externalReference: row.externalReference,
  note: row.note,
  decisionNote: row.decisionNote,
  amountKRW: row.amountKRW,
});
function recordedEvidence(actor: string | null, metric: "events" | "players") {
  const count = metric === "events" ? sql`count(distinct r.post_id)` : sql`count(*)`;
  return sql<number>`(select ${count}::int
    from sliper.template_provenance tp
    join sliper.event_results r on r.post_id=tp.post_id
    join sliper.event_settings es on es.post_id=r.post_id
    join sliper.posts played on played.id=r.post_id
    left join sliper.event_lifecycle lifecycle on lifecycle.post_id=played.id
    where tp.entry_id=sliper.library_entries.id and r.presence='attended'
      and es.completed_at is not null and es.ends_at <= statement_timestamp()
      and played.status='published' and not played.sample
      and lifecycle.cancelled_at is null and played.author_id is not null
      and ${contentVisible("post", sql`played.id`)}
      and ${contentVisible("record", sql`played.id`)}
      and ${creditMemberVisible(
        actor ?? "00000000-0000-0000-0000-000000000000",
        sql`played.author_id`,
      )})`;
}
function databaseConflict(error: unknown): never {
  if (
    error &&
    typeof error === "object" &&
    (("code" in error && error.code === "23505") ||
      ("cause" in error &&
        error.cause &&
        typeof error.cause === "object" &&
        "code" in error.cause &&
        error.cause.code === "23505"))
  )
    throw new AppError("CONFLICT", "이미 등록된 구매 번호예요. 내용을 확인해주세요.");
  throw error;
}
export function libraryService(db: Database) {
  async function locked(
    tx: Transaction,
    id: string,
    actor: string | null = null,
    allowDraft = false,
  ) {
    const [entry] = await tx
      .select()
      .from(libraryEntries)
      .where(
        and(
          eq(libraryEntries.id, uuidSchema.parse(id)),
          sql`${libraryEntries.ownerId} is not null`,
          creditMemberVisible(
            actor ?? "00000000-0000-0000-0000-000000000000",
            libraryEntries.ownerId,
          ),
        ),
      )
      .for("update");
    await assertContentVisible(tx as unknown as Database, "library", id);
    if (
      !entry ||
      (entry.status !== "published" &&
        !(allowDraft && entry.status === "draft" && actor === entry.ownerId))
    )
      throw new AppError("NOT_FOUND", "자료를 찾을 수 없어요.");
    return entry;
  }
  async function owner(tx: Transaction, actor: string | null, id: string) {
    const user = await requireRecordMember(tx as unknown as Database, actor),
      entry = await locked(tx, id, user, true);
    if (entry.ownerId !== user)
      throw new AppError("FORBIDDEN", "작성자만 자료를 관리할 수 있어요.");
    return entry;
  }
  async function revision(tx: Transaction, id: string) {
    const [row] = await tx
      .select({ at: preciseTimestamp(libraryEntries.updatedAt) })
      .from(libraryEntries)
      .where(eq(libraryEntries.id, id));
    return row!.at;
  }
  async function assertRevision(tx: Transaction, entry: Entry, expected: string) {
    if ((await revision(tx, entry.id)) !== expected)
      throw new AppError(
        "CONFLICT",
        "다른 화면에서 수정한 내용이 있어요. 최신 자료를 불러온 뒤 다시 수정해주세요.",
      );
  }
  async function sourceVersion(tx: Transaction, actor: string | null, id: string | null) {
    if (!id) return null;
    const [row] = await tx
      .select({
        entryId: libraryVersions.entryId,
        number: libraryVersions.number,
        content: libraryVersions.content,
      })
      .from(libraryVersions)
      .innerJoin(libraryEntries, eq(libraryEntries.id, libraryVersions.entryId))
      .where(
        and(
          eq(libraryVersions.id, id),
          eq(libraryEntries.status, "published"),
          contentVisible("library", libraryEntries.id),
          sql`${libraryEntries.ownerId} is not null`,
          creditMemberVisible(
            actor ?? "00000000-0000-0000-0000-000000000000",
            libraryEntries.ownerId,
          ),
        ),
      );
    return row ? { entryId: row.entryId, number: row.number, title: row.content.title } : null;
  }
  async function sourceRecord(tx: Transaction, actor: string | null, id: string | null) {
    return visibleRecordSource(tx as unknown as Database, actor, id);
  }
  async function distributionGuard(tx: Transaction, entry: Entry, content: LibraryInput) {
    if (entry.kind !== content.kind)
      throw new AppError("VALIDATION", "자료 종류는 변경할 수 없어요.");
    if (entry.sourceVersionId) {
      const [original] = await tx
        .select({ version: libraryVersions, entry: libraryEntries })
        .from(libraryVersions)
        .innerJoin(libraryEntries, eq(libraryEntries.id, libraryVersions.entryId))
        .where(eq(libraryVersions.id, entry.sourceVersionId));
      if (!original || !(await sourceVersion(tx, entry.ownerId, entry.sourceVersionId)))
        throw new AppError("FORBIDDEN", "원본 자료를 확인할 수 없어 발행할 수 없어요.");
      const originalContent = libraryInputSchema.parse(original.version.content);
      if (
        !(await versionAccess(tx, original.entry, originalContent, entry.ownerId)) ||
        (original.entry.ownerId !== entry.ownerId && !originalContent.allowDerivatives)
      )
        throw new AppError("FORBIDDEN", "원본 자료의 이용 권한을 확인한 뒤 발행해주세요.");
      if (
        !originalContent.allowCommercialUse &&
        (content.priceKRW > 0 || content.allowCommercialUse)
      )
        throw new AppError("FORBIDDEN", "원본 자료의 이용 조건은 상업적 사용을 허용하지 않아요.");
      if (!originalContent.allowDerivatives && content.allowDerivatives)
        throw new AppError("FORBIDDEN", "원본 자료보다 넓은 파생 이용 권한을 부여할 수 없어요.");
    }
    if (
      entry.sourceRecordPostId &&
      !(await sourceRecord(tx, entry.ownerId, entry.sourceRecordPostId))
    )
      throw new AppError("FORBIDDEN", "원본 행사 기록을 확인할 수 없어 발행할 수 없어요.");
    if (entry.priceKRW !== content.priceKRW || entry.purchaseUrl !== content.purchaseUrl) {
      const [purchase] = await tx
        .select({ userId: libraryAccessRequests.userId })
        .from(libraryAccessRequests)
        .where(
          and(
            eq(libraryAccessRequests.entryId, entry.id),
            or(
              eq(libraryAccessRequests.status, "pending"),
              eq(libraryAccessRequests.status, "approved"),
            ),
          ),
        )
        .limit(1);
      if (purchase)
        throw new AppError(
          "CONFLICT",
          "진행 중이거나 승인된 구매가 있어 가격과 구매 링크를 변경할 수 없어요.",
        );
    }
  }
  async function approved(tx: Transaction, entryId: string, actor: string | null) {
    if (!actor) return false;
    const [grant] = await tx
      .select({ status: libraryAccessRequests.status })
      .from(libraryAccessRequests)
      .where(
        and(eq(libraryAccessRequests.entryId, entryId), eq(libraryAccessRequests.userId, actor)),
      );
    return grant?.status === "approved";
  }
  async function versionAccess(
    tx: Transaction,
    entry: Entry,
    content: LibraryInput,
    actor: string | null,
  ) {
    return entry.ownerId === actor || !content.priceKRW || (await approved(tx, entry.id, actor));
  }
  async function createDraft(
    actor: string | null,
    input: unknown,
    trustedSource: { sourceVersionId?: string; sourceRecordPostId?: string } = {},
  ) {
    const user = await requireRecordMember(db, actor),
      content = libraryInputSchema.parse(input);
    const [row] = await db
      .insert(libraryEntries)
      .values({
        ...content,
        ownerId: user,
        status: "draft",
        draftContent: content,
        sourceVersionId: trustedSource.sourceVersionId ?? null,
        sourceRecordPostId: trustedSource.sourceRecordPostId ?? null,
      })
      .returning({ id: libraryEntries.id });
    return detail(user, row!.id);
  }
  async function hasAccess(tx: Transaction, entry: Entry, actor: string | null) {
    if (!entry.priceKRW || entry.ownerId === actor) return true;
    if (!actor) return false;
    const [grant] = await tx
      .select({ status: libraryAccessRequests.status })
      .from(libraryAccessRequests)
      .where(
        and(eq(libraryAccessRequests.entryId, entry.id), eq(libraryAccessRequests.userId, actor)),
      );
    return grant?.status === "approved";
  }
  async function summary(
    entry: Entry,
    actor: string | null,
    tx: Transaction,
  ): Promise<LibrarySummary> {
    const [author] = entry.ownerId
      ? await tx
          .select({ nickname: profiles.nickname, publicId: profiles.publicId })
          .from(profiles)
          .where(eq(profiles.id, entry.ownerId))
      : [];
    const [evidence] = await tx
      .select({
        events: recordedEvidence(actor, "events"),
        players: recordedEvidence(actor, "players"),
        visibleUseCases: visibleLibraryUseCases(tx, actor),
      })
      .from(libraryEntries)
      .where(eq(libraryEntries.id, entry.id));
    return {
      id: entry.id,
      kind: entry.kind as LibraryKind,
      category: entry.categorySlug,
      title: entry.title,
      summary: entry.summary,
      discoveryMetadata: entry.discoveryMetadata ?? null,
      minPlayers: entry.minPlayers,
      maxPlayers: entry.maxPlayers,
      durationMinutes: entry.durationMinutes,
      tags: entry.tags,
      priceKRW: entry.priceKRW,
      author: author?.nickname ?? "탈퇴한 회원",
      authorPublicId: author?.publicId ?? null,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: await revision(tx, entry.id),
      status: entry.status as "draft" | "published",
      publishedVersion: entry.publishedVersion,
      isMine: entry.ownerId === actor,
      recordedEvents: Number(evidence?.events ?? 0),
      recordedPlayers: Number(evidence?.players ?? 0),
      visibleUseCases: Number(evidence?.visibleUseCases ?? 0),
    };
  }
  async function detail(actor: string | null, id: string): Promise<LibraryDetail> {
    if (actor) await requireRecordMember(db, actor);
    return db.transaction(async (tx) => {
      const entry = await locked(tx, id, actor, true);
      if (actor) {
        const [safe] = await tx
          .select({ id: libraryEntries.id })
          .from(libraryEntries)
          .where(
            and(eq(libraryEntries.id, id), creditMemberVisible(actor, libraryEntries.ownerId)),
          );
        if (!safe) throw new AppError("NOT_FOUND", "자료를 찾을 수 없어요.");
      }
      const entitled = await hasAccess(tx, entry, actor),
        origin = await sourceVersion(tx, actor, entry.sourceVersionId);
      const [ownRequest] = actor
        ? await tx
            .select()
            .from(libraryAccessRequests)
            .where(
              and(
                eq(libraryAccessRequests.entryId, entry.id),
                eq(libraryAccessRequests.userId, actor),
              ),
            )
        : [];
      return {
        ...(await summary(entry, actor, tx)),
        purchaseUrl: entry.purchaseUrl,
        payload: entitled ? payload(entry) : null,
        canHost: entry.status === "published" && !!actor && entitled,
        status: entry.status as "draft" | "published",
        publishedVersion: entry.publishedVersion,
        draftContent: entry.ownerId === actor ? entry.draftContent : null,
        usageTerms: entry.usageTerms,
        allowDerivatives: entry.allowDerivatives,
        allowCommercialUse: entry.allowCommercialUse,
        sourceVersionId: origin ? entry.sourceVersionId : null,
        sourceRecordPostId: await sourceRecord(tx, actor, entry.sourceRecordPostId),
        sourceVersion: origin,
        canDerive:
          entry.status === "published" &&
          !!actor &&
          entitled &&
          (entry.ownerId === actor || entry.allowDerivatives),
        myAccess: ownRequest ? accessView(ownRequest) : null,
      };
    });
  }
  return {
    detail,
    createDraft,
    async list(actor: string | null, input: unknown): Promise<LibraryPage> {
      if (actor) await requireRecordMember(db, actor);
      const value = libraryListSchema.parse(input),
        user = value.mine ? requireActor(actor) : null;
      if (value.used) requireActor(actor);
      const scope = pageScope([
          "library-discovery-v1",
          actor,
          value.players ?? null,
          value.maxDurationMinutes ?? null,
          value.price ?? null,
          value.used ?? false,
          value.difficulty ?? null,
          value.environment ?? null,
          value.maxStaff ?? null,
          value.kind ?? null,
          value.category ?? null,
          value.search,
          user,
        ]),
        position = decodeCursor(value.cursor, scope);
      const search = value.search.replace(/[\\%_]/g, "\\$&");
      const rows = await db
        .select({
          id: libraryEntries.id,
          kind: libraryEntries.kind,
          category: libraryEntries.categorySlug,
          title: libraryEntries.title,
          summary: libraryEntries.summary,
          discoveryMetadata: libraryEntries.discoveryMetadata,
          minPlayers: libraryEntries.minPlayers,
          maxPlayers: libraryEntries.maxPlayers,
          durationMinutes: libraryEntries.durationMinutes,
          tags: libraryEntries.tags,
          priceKRW: libraryEntries.priceKRW,
          author: profiles.nickname,
          authorPublicId: profiles.publicId,
          ownerId: libraryEntries.ownerId,
          status: libraryEntries.status,
          publishedVersion: libraryEntries.publishedVersion,
          createdAt: preciseTimestamp(libraryEntries.createdAt),
          updatedAt: preciseTimestamp(libraryEntries.updatedAt),
          recordedEvents: recordedEvidence(actor, "events"),
          recordedPlayers: recordedEvidence(actor, "players"),
          visibleUseCases: visibleLibraryUseCases(db, actor),
        })
        .from(libraryEntries)
        .leftJoin(profiles, eq(profiles.id, libraryEntries.ownerId))
        .where(
          and(
            user
              ? or(eq(libraryEntries.status, "published"), eq(libraryEntries.status, "draft"))
              : eq(libraryEntries.status, "published"),
            contentVisible("library", libraryEntries.id),
            sql`${libraryEntries.ownerId} is not null`,
            creditMemberVisible(
              actor ?? "00000000-0000-0000-0000-000000000000",
              libraryEntries.ownerId,
            ),
            value.players !== undefined
              ? and(
                  lte(libraryEntries.minPlayers, value.players),
                  gte(libraryEntries.maxPlayers, value.players),
                )
              : undefined,
            value.maxDurationMinutes !== undefined
              ? lte(libraryEntries.durationMinutes, value.maxDurationMinutes)
              : undefined,
            value.price === "free"
              ? eq(libraryEntries.priceKRW, 0)
              : value.price === "paid"
                ? gt(libraryEntries.priceKRW, 0)
                : undefined,
            value.used ? gt(visibleLibraryUseCases(db, actor), 0) : undefined,
            value.difficulty
              ? sql`${libraryEntries.discoveryMetadata}->>'preparationDifficulty'=${value.difficulty}`
              : undefined,
            value.environment
              ? sql`${libraryEntries.discoveryMetadata}->>'environment'=${value.environment}`
              : undefined,
            value.maxStaff !== undefined
              ? sql`(${libraryEntries.discoveryMetadata}->>'requiredStaff')::int <= ${value.maxStaff}`
              : undefined,
            value.kind ? eq(libraryEntries.kind, value.kind) : undefined,
            value.category ? eq(libraryEntries.categorySlug, value.category) : undefined,
            user ? eq(libraryEntries.ownerId, user) : undefined,
            value.search
              ? or(
                  ilike(libraryEntries.title, `%${search}%`),
                  ilike(libraryEntries.summary, `%${search}%`),
                )
              : undefined,
            position
              ? afterPosition(libraryEntries.createdAt, libraryEntries.id, position, "desc")
              : undefined,
          ),
        )
        .orderBy(desc(libraryEntries.createdAt), desc(libraryEntries.id))
        .limit(25);
      const page = rows.slice(0, 24),
        last = page.at(-1);
      return {
        items: page.map(({ ownerId, ...row }) => ({
          ...row,
          kind: row.kind as LibraryKind,
          status: row.status as "draft" | "published",
          author: row.author ?? "탈퇴한 회원",
          isMine: ownerId === actor,
          recordedEvents: Number(row.recordedEvents),
          recordedPlayers: Number(row.recordedPlayers),
          visibleUseCases: Number(row.visibleUseCases),
        })),
        nextCursor: rows.length > 24 && last ? encodeCursor(scope, last) : null,
        canWrite: !!actor,
      };
    },
    async create(actor: string | null, input: unknown) {
      const user = await requireRecordMember(db, actor),
        value = libraryInputSchema.parse(input);
      const id = await db.transaction(async (tx) => {
        const [entry] = await tx
          .insert(libraryEntries)
          .values({ ...value, ownerId: user, status: "draft" })
          .returning();
        const version = await appendLibraryVersion(tx, entry!, value, user, "최초 발행");
        await tx
          .update(libraryEntries)
          .set({ status: "published", publishedVersion: version.number })
          .where(eq(libraryEntries.id, entry!.id));
        return entry!.id;
      });
      return detail(user, id);
    },
    async update(actor: string | null, id: string, input: unknown) {
      const update = libraryUpdateSchema.parse(input),
        value = update.content;
      await db.transaction(async (tx) => {
        const entry = await owner(tx, actor, id);
        if (entry.status !== "published" || entry.sourceVersionId || entry.sourceRecordPostId)
          throw new AppError(
            "CONFLICT",
            "초안과 파생 자료는 초안을 저장한 뒤 공개 동의를 확인하여 발행해주세요.",
          );
        await assertRevision(tx, entry, update.expectedUpdatedAt);
        const content = preserveDiscoveryMetadata(value, entry);
        await distributionGuard(tx, entry, content);
        const version = await appendLibraryVersion(
          tx,
          entry,
          content,
          requireActor(actor),
          "자료 수정 후 발행",
        );
        await tx
          .update(libraryEntries)
          .set({
            ...content,
            eventPlan: content.eventPlan ?? null,
            status: "published",
            draftContent: null,
            publishedVersion: version.number,
            updatedAt: sql`greatest(clock_timestamp(), ${libraryEntries.updatedAt} + interval '1 microsecond')`,
          })
          .where(eq(libraryEntries.id, entry.id));
      });
      return detail(actor, id);
    },
    async saveDraft(actor: string | null, id: string, input: unknown) {
      const value = libraryUpdateSchema.parse(input);
      await db.transaction(async (tx) => {
        const entry = await owner(tx, actor, id);
        await assertRevision(tx, entry, value.expectedUpdatedAt);
        if (entry.kind !== value.content.kind)
          throw new AppError("VALIDATION", "자료 종류는 변경할 수 없어요.");
        const content = preserveDiscoveryMetadata(value.content, {
          ...entry,
          discoveryMetadata:
            entry.draftContent?.discoveryMetadata === undefined
              ? entry.discoveryMetadata
              : entry.draftContent.discoveryMetadata,
        });
        await tx
          .update(libraryEntries)
          .set({
            ...(entry.status === "draft"
              ? { ...content, eventPlan: content.eventPlan ?? null }
              : {}),
            draftContent: content,
            updatedAt: sql`greatest(clock_timestamp(), ${libraryEntries.updatedAt} + interval '1 microsecond')`,
          })
          .where(eq(libraryEntries.id, id));
      });
      return detail(actor, id);
    },
    async publish(actor: string | null, id: string, input: unknown) {
      const value = libraryPublishSchema.parse(input);
      await db.transaction(async (tx) => {
        const entry = await owner(tx, actor, id);
        await assertRevision(tx, entry, value.expectedUpdatedAt);
        if (!entry.draftContent) throw new AppError("CONFLICT", "발행할 초안이 없어요.");
        const content = preserveDiscoveryMetadata(
          libraryInputSchema.parse(entry.draftContent),
          entry,
        );
        await distributionGuard(tx, entry, content);
        const version = await appendLibraryVersion(
          tx,
          entry,
          content,
          requireActor(actor),
          value.changeSummary,
        );
        await tx
          .update(libraryEntries)
          .set({
            ...content,
            eventPlan: content.eventPlan ?? null,
            status: "published",
            draftContent: null,
            publishedVersion: version.number,
            updatedAt: sql`greatest(clock_timestamp(), ${libraryEntries.updatedAt} + interval '1 microsecond')`,
          })
          .where(eq(libraryEntries.id, id));
      });
      return detail(actor, id);
    },
    async versions(
      actor: string | null,
      id: string,
      input: unknown = {},
    ): Promise<LibraryVersionPage> {
      if (actor) await requireRecordMember(db, actor);
      const query = libraryVersionQuerySchema.parse(input);
      return db.transaction(async (tx) => {
        await locked(tx, id, actor, true);
        const [count] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(libraryVersions)
          .where(eq(libraryVersions.entryId, id));
        const total = Number(count?.total ?? 0),
          pageCount = Math.ceil(total / 20),
          page = Math.min(query.page, Math.max(1, pageCount));
        const rows = await tx
          .select()
          .from(libraryVersions)
          .where(eq(libraryVersions.entryId, id))
          .orderBy(desc(libraryVersions.number))
          .limit(20)
          .offset((page - 1) * 20);
        const items = await Promise.all(
          rows.map(async (row) => {
            const origin = await sourceVersion(tx, actor, row.sourceVersionId);
            return {
              ...libraryVersionSummary(row),
              sourceVersion: origin,
              sourceVersionId: origin ? row.sourceVersionId : null,
              sourceRecordPostId: await sourceRecord(tx, actor, row.sourceRecordPostId),
            };
          }),
        );
        return { items, total, page, pageCount };
      });
    },
    async version(actor: string | null, id: string, number: number): Promise<LibraryVersionDetail> {
      if (actor) await requireRecordMember(db, actor);
      if (!Number.isInteger(number) || number < 1)
        throw new AppError("NOT_FOUND", "자료 버전을 찾을 수 없어요.");
      return db.transaction(async (tx) => {
        const entry = await locked(tx, id, actor, true);
        const [row] = await tx
          .select()
          .from(libraryVersions)
          .where(and(eq(libraryVersions.entryId, id), eq(libraryVersions.number, number)));
        if (!row) throw new AppError("NOT_FOUND", "자료 버전을 찾을 수 없어요.");
        const content = libraryInputSchema.parse(row.content),
          allowed = await versionAccess(tx, entry, content, actor),
          origin = await sourceVersion(tx, actor, row.sourceVersionId);
        return {
          ...libraryVersionSummary(row),
          sourceVersion: origin,
          sourceVersionId: origin ? row.sourceVersionId : null,
          sourceRecordPostId: await sourceRecord(tx, actor, row.sourceRecordPostId),
          content: allowed ? content : null,
          payload: allowed ? libraryVersionPayload(content) : null,
          canDerive: !!actor && allowed && (entry.ownerId === actor || content.allowDerivatives),
        };
      });
    },
    async derive(actor: string | null, id: string, input: unknown = {}) {
      const user = await requireRecordMember(db, actor),
        value = libraryDeriveSchema.parse(input);
      const draftId = await db.transaction(async (tx) => {
        const entry = await locked(tx, id, user),
          currentVersion = await ensurePublishedLibraryVersion(tx, entry);
        const [version] = await tx
          .select()
          .from(libraryVersions)
          .where(
            and(
              eq(libraryVersions.entryId, id),
              eq(libraryVersions.number, value.version ?? currentVersion.number),
            ),
          );
        if (!version) throw new AppError("NOT_FOUND", "자료 버전을 찾을 수 없어요.");
        const original = libraryInputSchema.parse(version.content);
        if (
          !(await versionAccess(tx, entry, original, user)) ||
          (entry.ownerId !== user && !original.allowDerivatives)
        )
          throw new AppError(
            "FORBIDDEN",
            "원본 자료의 이용 조건이나 구매 권한상 파생 자료를 만들 수 없어요.",
          );
        const content = {
          ...original,
          title: original.title.slice(0, 112) + " · 파생 초안",
          priceKRW: 0,
          purchaseUrl: null,
          allowDerivatives: false,
          allowCommercialUse: false,
        };
        const [draft] = await tx
          .insert(libraryEntries)
          .values({
            ...content,
            eventPlan: content.eventPlan ?? null,
            ownerId: user,
            status: "draft",
            draftContent: content,
            sourceVersionId: version.id,
          })
          .returning({ id: libraryEntries.id });
        return draft!.id;
      });
      return detail(user, draftId);
    },
    async remove(actor: string | null, id: string) {
      return db.transaction(async (tx) => {
        const entry = await owner(tx, actor, id);
        const [purchase] = await tx
          .select({ userId: libraryAccessRequests.userId })
          .from(libraryAccessRequests)
          .where(
            and(
              eq(libraryAccessRequests.entryId, entry.id),
              or(
                eq(libraryAccessRequests.status, "pending"),
                eq(libraryAccessRequests.status, "approved"),
              ),
            ),
          )
          .limit(1);
        if (purchase)
          throw new AppError(
            "CONFLICT",
            "구매 대기 또는 이용 중인 유저가 있어 자료를 삭제할 수 없어요.",
          );
        await tx
          .update(libraryEntries)
          .set({ status: "deleted", updatedAt: new Date() })
          .where(eq(libraryEntries.id, entry.id));
        return { id: entry.id };
      });
    },
    async requestAccess(actor: string | null, id: string, input: unknown) {
      const user = await requireRecordMember(db, actor),
        value = libraryAccessSchema.parse(input);
      try {
        await db.transaction(async (tx) => {
          const entry = await locked(tx, id, actor);
          if (!entry.priceKRW || entry.ownerId === user)
            throw new AppError("CONFLICT", "이미 이용할 수 있는 자료예요.");
          const [marketPurchase] = await tx
            .select({ id: libraryPurchases.id })
            .from(libraryPurchases)
            .where(
              and(
                eq(libraryPurchases.entryId, entry.id),
                eq(libraryPurchases.buyerId, user),
                or(
                  sql`${libraryPurchases.status} in ('pending','paid')`,
                  eq(libraryPurchases.externalReference, value.externalReference),
                ),
              ),
            )
            .limit(1);
          if (marketPurchase)
            throw new AppError("CONFLICT", "구매 관리 화면에서 이 구매 내역을 확인해주세요.");
          const [previous] = await tx
            .select()
            .from(libraryAccessRequests)
            .where(
              and(
                eq(libraryAccessRequests.entryId, entry.id),
                eq(libraryAccessRequests.userId, user),
              ),
            );
          if (previous && ["pending", "approved"].includes(previous.status)) {
            if (previous.externalReference !== value.externalReference)
              throw new AppError("CONFLICT", "기존 구매 확인 요청을 먼저 확인해주세요.");
            return;
          }
          await tx
            .insert(libraryAccessRequests)
            .values({
              entryId: entry.id,
              userId: user,
              externalReference: value.externalReference,
              amountKRW: entry.priceKRW,
              note: value.note,
            })
            .onConflictDoUpdate({
              target: [libraryAccessRequests.entryId, libraryAccessRequests.userId],
              set: {
                externalReference: value.externalReference,
                amountKRW: entry.priceKRW,
                note: value.note,
                status: "pending",
                decisionNote: "",
                updatedAt: new Date(),
              },
            });
        });
      } catch (e) {
        databaseConflict(e);
      }
      return detail(actor, id);
    },
    async accessRequests(
      actor: string | null,
      id: string,
      cursor?: string,
    ): Promise<LibraryAccessPage> {
      return db.transaction(async (tx) => {
        await owner(tx, actor, id);
        const scope = pageScope(["library-access", requireActor(actor), id]),
          position = decodeCursor(cursor, scope);
        const rows = await tx
          .select({
            request: libraryAccessRequests,
            publicId: profiles.publicId,
            nickname: profiles.nickname,
            createdAt: preciseTimestamp(libraryAccessRequests.createdAt),
          })
          .from(libraryAccessRequests)
          .innerJoin(profiles, eq(profiles.id, libraryAccessRequests.userId))
          .where(
            and(
              eq(libraryAccessRequests.entryId, uuidSchema.parse(id)),
              sql`not exists(select 1 from sliper.library_purchases mp where mp.entry_id=${libraryAccessRequests.entryId} and mp.buyer_id=${libraryAccessRequests.userId} and mp.external_reference=${libraryAccessRequests.externalReference})`,
              position
                ? afterPosition(
                    libraryAccessRequests.createdAt,
                    profiles.publicId,
                    position,
                    "desc",
                  )
                : undefined,
            ),
          )
          .orderBy(desc(libraryAccessRequests.createdAt), desc(profiles.publicId))
          .limit(31);
        const page = rows.slice(0, 30),
          last = page.at(-1);
        return {
          items: page.map((row) => ({
            ...accessView(row.request),
            userPublicId: row.publicId,
            nickname: row.nickname,
            createdAt: row.createdAt,
          })),
          nextCursor:
            rows.length > 30 && last
              ? encodeCursor(scope, { id: last.publicId, createdAt: last.createdAt })
              : null,
        };
      });
    },
    async decideAccess(actor: string | null, id: string, input: unknown) {
      const value = libraryDecisionSchema.parse(input);
      await db.transaction(async (tx) => {
        const entry = await owner(tx, actor, id);
        const [profile] = await tx
          .select({ id: profiles.id })
          .from(profiles)
          .where(eq(profiles.publicId, value.userPublicId));
        const [request] = profile
          ? await tx
              .select()
              .from(libraryAccessRequests)
              .where(
                and(
                  eq(libraryAccessRequests.entryId, entry.id),
                  eq(libraryAccessRequests.userId, profile.id),
                ),
              )
          : [];
        if (!request) throw new AppError("NOT_FOUND", "구매 확인 요청을 찾을 수 없어요.");
        const [marketPurchase] = await tx
          .select({ id: libraryPurchases.id })
          .from(libraryPurchases)
          .where(
            and(
              eq(libraryPurchases.entryId, entry.id),
              eq(libraryPurchases.buyerId, request.userId),
              eq(libraryPurchases.externalReference, request.externalReference),
            ),
          )
          .limit(1);
        if (marketPurchase)
          throw new AppError("CONFLICT", "새 구매 기록은 판매 관리 화면에서 처리해주세요.");
        const status =
          value.decision === "approve"
            ? "approved"
            : value.decision === "reject"
              ? "rejected"
              : "revoked";
        if (
          value.decision === "approve" &&
          (!value.paymentChecked || request.amountKRW !== entry.priceKRW)
        )
          throw new AppError("CONFLICT", "외부 구매 금액을 확인해주세요.");
        if (
          (value.decision === "approve" || value.decision === "reject") &&
          request.status !== "pending"
        )
          throw new AppError("CONFLICT", "구매 확인 대기 요청만 처리할 수 있어요.");
        if (value.decision === "revoke" && request.status !== "approved")
          throw new AppError("CONFLICT", "승인된 이용 권한만 회수할 수 있어요.");
        await tx
          .update(libraryAccessRequests)
          .set({ status, decisionNote: value.note, updatedAt: new Date() })
          .where(
            and(
              eq(libraryAccessRequests.entryId, entry.id),
              eq(libraryAccessRequests.userId, request.userId),
            ),
          );
      });
      return { ok: true };
    },
    async download(actor: string | null, id: string) {
      const entry = await detail(actor, id);
      if (!entry.payload)
        throw new AppError("FORBIDDEN", "구매 확인 후 자료를 다운로드할 수 있어요.");
      const p = entry.payload,
        publication =
          entry.status === "draft"
            ? "초안 (비공개)"
            : entry.publishedVersion > 0
              ? `v${entry.publishedVersion}`
              : "이전 자료 · 버전 미확인",
        origins = [
          `자료: [${entry.title}](/archive/${entry.id})`,
          entry.status === "published" && entry.publishedVersion > 0
            ? `현재 발행본: [v${entry.publishedVersion}](/archive/${entry.id}?version=${entry.publishedVersion})`
            : "",
          entry.sourceVersion
            ? `파생 원본: [${entry.sourceVersion.title} · v${entry.sourceVersion.number}](/archive/${entry.sourceVersion.entryId}?version=${entry.sourceVersion.number})`
            : "",
          entry.sourceRecordPostId
            ? `원본 행사 기록: [행사 기록](/records/${entry.sourceRecordPostId})`
            : "",
        ]
          .filter(Boolean)
          .join("\n");
      return {
        title: entry.title,
        markdown: `# ${entry.title}\n\n자료 상태: ${publication}\n원저작자: ${entry.author}\n${origins}\n\n${entry.summary}\n\n## 이용 조건\n${entry.usageTerms}\n\n- 파생 자료 제작: ${entry.allowDerivatives ? "허용" : "허용하지 않음"}\n- 상업적 이용: ${entry.allowCommercialUse ? "허용" : "허용하지 않음"}\n\n${p.eventPlan ? eventPlanMarkdown(p.eventPlan) + "\n\n" : ""}## 시나리오\n${p.scenario}\n\n## 규칙\n${p.rules}\n\n## 준비물\n${p.materials.map((v) => `- [ ] ${v}`).join("\n")}\n\n## 진행자 가이드\n${p.hostGuide}\n\n## 라운드 타이머\n${p.rounds.map((v) => `- ${v.name}: ${v.seconds}초`).join("\n")}\n`,
      };
    },
    async host(actor: string | null, id: string, input: unknown) {
      const user = await requireRecordMember(db, actor),
        value = templateHostSchema.parse(input);
      if (new Date(value.startsAt).getTime() <= Date.now())
        throw new AppError("VALIDATION", "행사 시작 시간을 미래로 설정해주세요.");
      return db.transaction(async (tx) => {
        const entry = await locked(tx, id, actor),
          published = await ensurePublishedLibraryVersion(tx, entry),
          content = libraryInputSchema.parse(published.content);
        if (!(await versionAccess(tx, entry, content, user)))
          throw new AppError("FORBIDDEN", "템플릿 구매 확인 후 모임을 열 수 있어요.");
        if (value.capacity < content.minPlayers || value.capacity > content.maxPlayers)
          throw new AppError(
            "VALIDATION",
            `이 템플릿은 ${content.minPlayers}~${content.maxPlayers}명으로 진행해요.`,
          );
        if (entry.ownerId !== user && value.amountKRW > 0 && !content.allowCommercialUse)
          throw new AppError(
            "FORBIDDEN",
            "이 자료의 이용 조건은 참가비를 받는 모임을 허용하지 않아요.",
          );
        const base = await summary(entry, user, tx);
        const snapshot: TemplateSnapshot = {
          ...libraryVersionPayload(content),
          title: content.title,
          summary: content.summary,
          category: content.categorySlug,
          author: base.author,
          authorPublicId: base.authorPublicId,
          minPlayers: content.minPlayers,
          maxPlayers: content.maxPlayers,
          durationMinutes: content.durationMinutes,
          sourceId: entry.id,
          versionId: published.id,
          versionNumber: published.number,
          usageTerms: content.usageTerms,
          discoveryMetadata: content.discoveryMetadata ?? null,
          allowDerivatives: content.allowDerivatives,
          allowCommercialUse: content.allowCommercialUse,
        };
        const startsAt = new Date(value.startsAt),
          endsAt = new Date(value.endsAt);
        const date = new Intl.DateTimeFormat("ko-KR", {
          timeZone: "Asia/Seoul",
          dateStyle: "medium",
          timeStyle: "short",
        }).format(startsAt);
        const [post] = await tx
          .insert(posts)
          .values({
            authorId: user,
            categorySlug: content.categorySlug,
            kind: "모집",
            title: value.title,
            bodyMarkdown: `${value.description}\n\n---\n**이벤트 템플릿**: ${content.title} · 원저작자 ${base.author}\n\n${content.summary}\n\n환불 안내: 한국시간 행사 시작일 기준 5일 전까지 100%, 4일 전 80%, 3일 전 60%, 2일 전 40%, 1일 전 20%, 당일 이후 0%. 실제 결제·환불은 결제 플랫폼에서 처리합니다.`,
            location: value.location,
            eventDate: date,
            eventFee: value.amountKRW ? `${value.amountKRW.toLocaleString("ko-KR")}원` : "무료",
            applicationUrl: value.applicationUrl,
            tags: content.tags,
          })
          .returning({ id: posts.id });
        const postId = post!.id;
        await tx.insert(eventSettings).values({
          postId,
          venueLatitude: value.venue?.latitude ?? null,
          venueLongitude: value.venue?.longitude ?? null,
          amountKRW: value.amountKRW,
          capacity: value.capacity,
          open: true,
          approvalMode: "manual",
          startsAt,
          endsAt,
          refundPolicy: "sliper-v1",
        });
        await bindEventVenue(tx, user, postId, value.venue);
        await tx
          .insert(templateProvenance)
          .values({ postId, entryId: entry.id, versionId: published.id, snapshot });
        return { postId };
      });
    },
    async eventTemplate(actor: string | null, postId: string): Promise<TemplateSnapshot | null> {
      const user = await requireRecordMember(db, actor),
        id = uuidSchema.parse(postId);
      return db.transaction(async (tx) => {
        const [post] = await tx
          .select({ authorId: posts.authorId })
          .from(posts)
          .where(and(eq(posts.id, id), eq(posts.status, "published")))
          .for("update");
        if (!post) throw new AppError("NOT_FOUND", "행사를 찾을 수 없어요.");
        const [manager] = await tx
          .select({ userId: roomManagers.userId })
          .from(roomManagers)
          .where(and(eq(roomManagers.postId, id), eq(roomManagers.userId, user)));
        if (post.authorId !== user && !manager)
          throw new AppError("FORBIDDEN", "행사 담당자만 진행 가이드를 확인할 수 있어요.");
        const [source] = await tx
          .select({ snapshot: templateProvenance.snapshot })
          .from(templateProvenance)
          .where(eq(templateProvenance.postId, id));
        return source?.snapshot ?? null;
      });
    },
  };
}
