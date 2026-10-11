import { sql } from "drizzle-orm";
import { posts } from "../db/schema";
import { authorVisible, contentVisible } from "./safety-visibility";
/** Re-evaluate on every surface: removed/hidden/blocked/departed answers cannot resolve a question. */
export function visibleAnswerId(actor: string | null) {
  return sql<
    string | null
  >`(select c.id from sliper.question_resolutions qr join sliper.comments c on c.id=qr.comment_id and c.post_id=qr.post_id
 where qr.post_id=${posts.id} and ${posts.kind}='이야기' and ${posts.discussionType}='question'
 and c.status='published' and c.author_id is not null and c.author_id<>${posts.authorId}
 and ${contentVisible("comment", sql`c.id`)} and ${authorVisible(sql`c.author_id`, actor)}
 and not exists(select 1 from sliper.member_safety ms where ms.user_id=c.author_id and (ms.status='closed' or (ms.status='suspended' and (ms.suspended_until is null or ms.suspended_until>statement_timestamp())))))`;
}
export const previewTitleSql = sql<string>`case when ${posts.spoiler} then coalesce(${posts.spoilerTitle}, '스포일러가 포함된 이야기') else ${posts.title} end`;
export const previewBodySql = sql<string>`case when ${posts.spoiler} then coalesce(${posts.spoilerSummary}, '') else ${posts.bodyMarkdown} end`;
