import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/connection";
import { posts, profiles } from "../db/schema";
import { libraryEntries } from "../db/library-schema";
import {
  TOPICS,
  TOPIC_MAX_PAGE,
  TOPIC_PAGE_SIZE,
  TOPIC_TAG_WHITESPACE,
  topicAliases,
  topicForSlug,
  topicQuerySchema,
  type CuratedTopic,
  type TopicDetail,
  type TopicSection,
  type TopicPostSummary,
  type TopicLibrarySummary,
} from "../domain/topics";
import { createPostReader } from "./post-reader";
import { authorVisible, contentVisible } from "./safety-visibility";
import { creditMemberVisible } from "./event-credit-service";
import { requireRecordMember } from "./record-policy";
import { AppError } from "./errors";

// EXISTS avoids multiplying rows when an entry carries two aliases for one topic.
function explicitTags(tags: unknown, topic: CuratedTopic): SQL {
  const aliases = sql.join(
    topicAliases(topic).map((alias) => sql`${alias}`),
    sql`, `,
  );
  return sql`exists(select 1 from unnest(${tags}) topic_tag where lower(regexp_replace(translate(topic_tag, ${TOPIC_TAG_WHITESPACE}, ''), '^#', '')) in (${aliases}))`;
}
function section<T>(items: T[], total: number, requested: number): TopicSection<T> {
  const pageCount = Math.min(TOPIC_MAX_PAGE, Math.ceil(total / TOPIC_PAGE_SIZE));
  return {
    items,
    total,
    page: Math.min(requested, Math.max(1, pageCount)),
    pageSize: TOPIC_PAGE_SIZE,
    pageCount,
    limited: total > TOPIC_MAX_PAGE * TOPIC_PAGE_SIZE,
  };
}
export function topicService(db: Database) {
  return {
    catalog() {
      return { topics: TOPICS };
    },
    async detail(actor: string | null, slug: string, input: unknown = {}): Promise<TopicDetail> {
      const topic = topicForSlug(slug);
      if (!topic) throw new AppError("NOT_FOUND", "주제를 찾을 수 없어요.");
      const query = topicQuerySchema.parse(input);
      if (actor) await requireRecordMember(db, actor);
      return db.transaction(
        async (tx) => {
          const connection = tx as unknown as Database;
          let interestFeed: TopicDetail["interestFeed"] = "all";
          let interests: SQL | undefined;
          if (query.focus === "interests") {
            const [subscribed] = actor
              ? await tx
                  .select({
                    exists: sql<boolean>`exists(select 1 from sliper.category_subscriptions where user_id=${actor}) or exists(select 1 from sliper.host_subscriptions where user_id=${actor})`,
                  })
                  .from(sql`(select 1) one`)
              : [];
            interestFeed = !actor ? "login" : subscribed?.exists ? "personalized" : "setup";
            if (interestFeed === "personalized")
              interests = sql`(exists(select 1 from sliper.category_subscriptions cs where cs.user_id=${actor} and cs.category_slug=${posts.categorySlug}::text) or (not ${posts.isAnonymous} and exists(select 1 from sliper.host_subscriptions hs where hs.user_id=${actor} and hs.host_id=${posts.authorId})))`;
          }
          const visiblePosts = and(
            eq(posts.status, "published"),
            eq(posts.spoiler, false),
            contentVisible("post", posts.id),
            authorVisible(posts.authorId, actor),
            sql`${posts.authorId} is not null`,
            creditMemberVisible(actor ?? "00000000-0000-0000-0000-000000000000", posts.authorId),
            explicitTags(posts.tags, topic),
            interests,
          );
          async function postSection(
            recruitment: boolean,
            requested: number,
          ): Promise<TopicSection<TopicPostSummary>> {
            const condition = and(
              visiblePosts,
              recruitment ? eq(posts.kind, "모집") : sql`${posts.kind} in ('이야기','후기','투표')`,
            );
            const [count] = await tx
              .select({ total: sql<number>`count(*)::int` })
              .from(posts)
              .where(condition);
            const total = Number(count?.total ?? 0),
              page = Math.min(
                requested,
                Math.max(1, Math.min(TOPIC_MAX_PAGE, Math.ceil(total / TOPIC_PAGE_SIZE))),
              );
            const rows = await createPostReader(connection).projectPosts(
              condition,
              actor,
              TOPIC_PAGE_SIZE,
              false,
              undefined,
              (page - 1) * TOPIC_PAGE_SIZE,
            );
            return section(
              rows.map((post) => ({
                id: post.id,
                href: recruitment ? "/events/" + post.id : "/posts/" + post.id,
                kind: post.kind,
                category: post.category,
                title: post.title,
                excerpt: post.excerpt,
                author: post.author,
                anonymous: post.anonymous,
                spoiler: post.spoiler ?? false,
                discussionType: post.discussionType ?? null,
                createdAt: post.createdAt,
                likes: post.likes,
                comments: post.comments,
                location: recruitment ? (post.location ?? null) : null,
                eventStartsAt: recruitment ? (post.eventStartsAt ?? null) : null,
                eventAvailable: recruitment && !!post.eventAvailable,
                eventAmountKRW: recruitment ? (post.eventAmountKRW ?? null) : null,
              })),
              total,
              requested,
            );
          }
          // Public summary fields only. No paid eventPlan, body, provenance or record metrics.
          const visibleLibrary = and(
            eq(libraryEntries.status, "published"),
            contentVisible("library", libraryEntries.id),
            sql`${libraryEntries.ownerId} is not null`,
            creditMemberVisible(
              actor ?? "00000000-0000-0000-0000-000000000000",
              libraryEntries.ownerId,
            ),
            explicitTags(libraryEntries.tags, topic),
          );
          const [count] = await tx
            .select({ total: sql<number>`count(*)::int` })
            .from(libraryEntries)
            .where(visibleLibrary);
          const total = Number(count?.total ?? 0),
            libraryPage = Math.min(
              query.libraryPage,
              Math.max(1, Math.min(TOPIC_MAX_PAGE, Math.ceil(total / TOPIC_PAGE_SIZE))),
            );
          const entries = await tx
            .select({
              id: libraryEntries.id,
              kind: libraryEntries.kind,
              category: libraryEntries.categorySlug,
              title: libraryEntries.title,
              summary: libraryEntries.summary,
              author: profiles.nickname,
              priceKRW: libraryEntries.priceKRW,
              createdAt: libraryEntries.createdAt,
            })
            .from(libraryEntries)
            .leftJoin(profiles, eq(profiles.id, libraryEntries.ownerId))
            .where(visibleLibrary)
            .orderBy(desc(libraryEntries.createdAt), desc(libraryEntries.id))
            .limit(TOPIC_PAGE_SIZE)
            .offset((libraryPage - 1) * TOPIC_PAGE_SIZE);
          const library = section<TopicLibrarySummary>(
            entries.map((entry) => ({
              ...entry,
              href: "/archive/" + entry.id,
              kind: entry.kind as TopicLibrarySummary["kind"],
              author: entry.author ?? "탈퇴한 회원",
              createdAt: entry.createdAt.toISOString(),
            })),
            total,
            query.libraryPage,
          );
          const stories = await postSection(false, query.storiesPage);
          const recruitment = await postSection(true, query.recruitmentPage);
          return {
            topic,
            query: {
              ...query,
              storiesPage: stories.page,
              recruitmentPage: recruitment.page,
              libraryPage: library.page,
            },
            interestFeed,
            stories,
            recruitment,
            library,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
  };
}
