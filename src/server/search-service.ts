import { sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import type { CategorySlug } from "../domain/categories";
import {
  SEARCH_MAX_PAGE,
  SEARCH_PAGE_SIZE,
  escapeSearchLike,
  searchInputSchema,
  type SearchPage,
  type SearchResultType,
  type SearchType,
} from "../domain/search";
import { requireRecordMember } from "./record-policy";
import { creditMemberVisible } from "./event-credit-service";
import { authorVisible, contentVisible } from "./safety-visibility";

const emptyCounts = (): Record<SearchType, number> => ({
  all: 0,
  story: 0,
  recruitment: 0,
  rulebook: 0,
  template: 0,
  record: 0,
});
function excerpt(value: string) {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " 사진 ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>`\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}
export function searchService(db: Database) {
  return {
    async search(actor: string | null, input: unknown): Promise<SearchPage> {
      const value = searchInputSchema.parse(input);
      if (!value.q)
        return {
          query: { ...value, page: 1 },
          items: [],
          counts: emptyCounts(),
          total: 0,
          page: 1,
          pageCount: 0,
          limited: false,
        };
      const recordActor = actor ? await requireRecordMember(db, actor) : null;
      const pattern = `%${escapeSearchLike(value.q)}%`;
      // Never project full records: paid library payloads, contact details and
      // authentication IDs stay out of both SQL results and serialized DTOs.
      const matches = sql`
        select p.id, case when p.kind='모집' then 'recruitment' else 'story' end as type,
          p.category_slug::text as category, p.spoiler, case when p.kind='이야기' then coalesce(p.discussion_type,'free') else null end as "discussionType", (case when p.spoiler then coalesce(p.spoiler_title,'스포일러가 포함된 이야기') else p.title end)::text as title,
          case when p.spoiler then coalesce(p.spoiler_summary,'내용과 댓글에 스포일러가 있어요.') else left(p.body_markdown, 1000) end as preview,
          case when p.spoiler then ARRAY[]::text[] else p.tags end as tags,
          case when p.is_anonymous then '익명' else coalesce(pp.nickname,'탈퇴한 회원') end as author,
          p.created_at as "createdAt"
        from sliper.posts p
        left join sliper.profiles pp on pp.id=p.author_id
        where p.status='published'
          and ${contentVisible("post", sql`p.id`)}
          and ${authorVisible(sql`p.author_id`, actor)}
          and (case when p.spoiler then coalesce(p.spoiler_title,'') || ' ' || coalesce(p.spoiler_summary,'') else p.title || ' ' || p.body_markdown || ' ' || sliper.search_tags(p.tags) end) ilike ${pattern}
          ${value.category ? sql`and p.category_slug=${value.category}` : sql``}
          ${value.discussionType ? sql`and p.kind='이야기' and coalesce(p.discussion_type,'free')=${value.discussionType}` : sql``}
        union all
        select l.id, l.kind as type, l.category_slug::text as category, false as spoiler, null::text as "discussionType",
          l.title::text as title, l.summary::text as preview, l.tags,
          coalesce(lp.nickname,'탈퇴한 회원') as author, l.created_at as "createdAt"
        from sliper.library_entries l
        left join sliper.profiles lp on lp.id=l.owner_id
        where l.status='published'
          and l.kind in ('rulebook','template')
          ${value.discussionType ? sql`and false` : sql``}
          and ${contentVisible("library", sql`l.id`)}
          and l.owner_id is not null
          and ${creditMemberVisible(actor ?? "00000000-0000-0000-0000-000000000000", sql`l.owner_id`)}
          and (l.title || ' ' || l.summary || ' ' || sliper.search_tags(l.tags)) ilike ${pattern}
          ${value.category ? sql`and l.category_slug=${value.category}` : sql``}
        ${
          recordActor
            ? sql`union all
        select r.post_id as id,'record'::text as type,r.snapshot->>'category' as category, false as spoiler, null::text as "discussionType",r.snapshot->>'title' as title,
        left(r.purpose || ' ' || r.execution || ' ' || r.body_markdown,1000) as preview,ARRAY[]::text[] as tags,
        coalesce(host.nickname,'탈퇴한 회원') as author,r.completed_at as "createdAt"
        from sliper.event_records r join sliper.posts p on p.id=r.post_id join sliper.event_settings es on es.post_id=p.id
        left join sliper.profiles host on host.id=r.owner_id left join sliper.event_lifecycle lc on lc.post_id=p.id
        where ${value.discussionType ? sql`false` : sql`true`} and r.owner_id is not null and r.status='published' and es.completed_at is not null and p.status='published' and not p.sample and lc.cancelled_at is null
        and ${contentVisible("post", sql`p.id`)} and ${contentVisible("record", sql`p.id`)}
        and not exists(select 1 from sliper.member_blocks b where (b.blocker_id=${recordActor}::uuid and b.blocked_id=r.owner_id) or (b.blocked_id=${recordActor}::uuid and b.blocker_id=r.owner_id))
        and not exists(select 1 from sliper.member_safety m where m.user_id=r.owner_id and (m.status='closed' or (m.status='suspended' and (m.suspended_until is null or m.suspended_until>statement_timestamp()))))
        and (r.snapshot->>'title' || ' ' || r.purpose || ' ' || r.execution || ' ' || r.body_markdown) ilike ${pattern}
        ${value.category ? sql`and r.snapshot->>'category'=${value.category}` : sql``}
        `
            : sql``
        }
      `;
      return db.transaction(
        async (tx) => {
          const countRows = await tx
            .select({ type: sql<SearchResultType>`type`, total: sql<number>`count(*)::int` })
            .from(sql`(${matches}) matches`)
            .groupBy(sql`type`);
          const counts = emptyCounts();
          for (const row of countRows) {
            counts[row.type] = Number(row.total);
            counts.all += Number(row.total);
          }
          const total = counts[value.type];
          const pageCount = Math.min(SEARCH_MAX_PAGE, Math.ceil(total / SEARCH_PAGE_SIZE));
          const page = Math.min(value.page, Math.max(1, pageCount));
          const rows = await tx
            .select({
              id: sql<string>`id`,
              type: sql<SearchResultType>`type`,
              category: sql<CategorySlug>`category`,
              title: sql<string>`title`,
              spoiler: sql<boolean>`spoiler`,
              discussionType: sql<
                import("../domain/discussions").DiscussionType | null
              >`"discussionType"`,
              preview: sql<string>`preview`,
              tags: sql<string[]>`tags`,
              author: sql<string>`author`,
              createdAt: sql<string | Date>`"createdAt"`,
            })
            .from(sql`(${matches}) matches`)
            .where(value.type === "all" ? undefined : sql`type=${value.type}`)
            .orderBy(sql`"createdAt" desc`, sql`id desc`, sql`type asc`)
            .limit(SEARCH_PAGE_SIZE)
            .offset((page - 1) * SEARCH_PAGE_SIZE);
          return {
            query: { ...value, page },
            items: rows.map(({ preview, createdAt, ...row }) => ({
              ...row,
              createdAt: new Date(createdAt).toISOString(),
              excerpt: excerpt(preview),
              href:
                row.type === "record"
                  ? `/records/${row.id}`
                  : row.type === "rulebook" || row.type === "template"
                    ? `/archive/${row.id}`
                    : `/posts/${row.id}`,
            })),
            counts,
            total,
            page,
            pageCount,
            limited: total > SEARCH_MAX_PAGE * SEARCH_PAGE_SIZE,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
  };
}
