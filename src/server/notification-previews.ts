import { eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { EngagementConnection } from "./engagement-events";
import { posts, comments, profiles, roomMessages, eventApplications } from "../db/schema";
import { eventChanges } from "../db/event-lifecycle-schema";
import { crewMessages, crews } from "../db/crew-schema";
import { notificationSnippet, PARTICIPATION_COPY } from "../domain/notification-copy";
interface PreviewItem {
  id: string;
  recipientId: string;
  kind: string;
  postId: string | null;
  sourceId?: string | null;
  dedupeKey: string;
  title: string;
  body: string;
}
const parentComment = alias(comments, "preview_parent_comment");
function source(item: PreviewItem) {
  return (
    item.sourceId ??
    /^(?:room|application|event-change|crew-message):([0-9a-f-]{36})(?::|$)/i.exec(
      item.dedupeKey,
    )?.[1] ??
    null
  );
}
/** Call only for authorized inbox rows or deliveries whose source access is checked again before sending. */
export async function notificationPreviews(db: EngagementConnection, items: PreviewItem[]) {
  const unique = (values: (string | null | undefined)[]) => [
    ...new Set(values.filter((value): value is string => !!value)),
  ];
  const postIds = unique(items.map((item) => item.postId));
  const ids = (kinds: string[]) =>
    unique(items.filter((item) => kinds.includes(item.kind)).map(source));
  const commentIds = ids(["comment", "comments"]),
    announcementIds = ids(["announcement", "announcements"]);
  const applicationIds = unique(
    items.filter((item) => item.dedupeKey.startsWith("application:")).map(source),
  );
  const changeIds = unique(
    items.filter((item) => item.dedupeKey.startsWith("event-change:")).map(source),
  );
  const crewIds = ids(["crew_message"]);
  const [postRows, commentRows, announcementRows, applications, changes, crewRows] =
    await Promise.all([
      postIds.length
        ? db
            .select({
              id: posts.id,
              title: posts.title,
              spoiler: posts.spoiler,
              location: posts.location,
              date: posts.eventDate,
              fee: posts.eventFee,
            })
            .from(posts)
            .where(inArray(posts.id, postIds))
        : [],
      commentIds.length
        ? db
            .select({
              id: comments.id,
              body: comments.bodyMarkdown,
              anonymous: comments.isAnonymous,
              nickname: profiles.nickname,
              importedName: comments.importedAuthorName,
              parentAuthor: parentComment.authorId,
            })
            .from(comments)
            .leftJoin(profiles, eq(profiles.id, comments.authorId))
            .leftJoin(parentComment, eq(parentComment.id, comments.parentId))
            .where(inArray(comments.id, commentIds))
        : [],
      announcementIds.length
        ? db
            .select({ id: roomMessages.id, body: roomMessages.body, nickname: profiles.nickname })
            .from(roomMessages)
            .leftJoin(profiles, eq(profiles.id, roomMessages.authorId))
            .where(inArray(roomMessages.id, announcementIds))
        : [],
      applicationIds.length
        ? db
            .select({ id: eventApplications.id, status: eventApplications.status })
            .from(eventApplications)
            .where(inArray(eventApplications.id, applicationIds))
        : [],
      changeIds.length
        ? db
            .select({
              id: eventChanges.id,
              kind: eventChanges.kind,
              reason: eventChanges.reason,
              startsAt: eventChanges.startsAt,
            })
            .from(eventChanges)
            .where(inArray(eventChanges.id, changeIds))
        : [],
      crewIds.length
        ? db
            .select({
              id: crewMessages.id,
              body: crewMessages.body,
              name: crews.name,
              nickname: profiles.nickname,
            })
            .from(crewMessages)
            .innerJoin(crews, eq(crews.id, crewMessages.crewId))
            .leftJoin(profiles, eq(profiles.id, crewMessages.authorId))
            .where(inArray(crewMessages.id, crewIds))
        : [],
    ]);
  const result = new Map<string, { title: string; body: string }>();
  for (const item of items) {
    const post = postRows.find((row) => row.id === item.postId),
      id = source(item);
    const context = notificationSnippet(post?.title ?? "", 55);
    const bodyWithContext = (body: string) =>
      notificationSnippet((context ? context + " · " : "") + body, 200);
    if (post?.spoiler) {
      result.set(item.id, {
        title: "스포일러 글에 새 활동이 있어요",
        body: "글을 펼쳐 내용을 확인해주세요.",
      });
      continue;
    }
    const comment = commentRows.find((row) => row.id === id);
    const announcement = announcementRows.find((row) => row.id === id);
    const crewMessage = crewRows.find((row) => row.id === id);
    if ((item.kind === "comment" || item.kind === "comments") && comment) {
      const name = notificationSnippet(
        comment.anonymous ? "익명" : (comment.nickname ?? comment.importedName ?? "회원"),
        24,
      );
      result.set(item.id, {
        title:
          name +
          (comment.parentAuthor === item.recipientId
            ? "님이 내 댓글에 답글을 남겼어요"
            : "님이 내 글에 댓글을 남겼어요"),
        body: bodyWithContext(notificationSnippet(comment.body) || "첨부한 내용을 확인해주세요."),
      });
    } else if ((item.kind === "announcement" || item.kind === "announcements") && announcement) {
      result.set(item.id, {
        title: "모임 공지 · " + (context || "새 공지"),
        body: notificationSnippet(
          (announcement.nickname ?? "담당자") + " · " + announcement.body,
          200,
        ),
      });
    } else if (item.kind === "crew_message" && crewMessage) {
      result.set(item.id, {
        title:
          notificationSnippet(crewMessage.name, 45) +
          " · " +
          notificationSnippet(crewMessage.nickname ?? "크루원", 24),
        body: notificationSnippet(crewMessage.body, 200),
      });
    } else if (item.kind === "participation") {
      const application = applications.find((row) => row.id === id),
        change = changes.find((row) => row.id === id);
      if (application && PARTICIPATION_COPY[application.status]) {
        const copy = PARTICIPATION_COPY[application.status]!;
        result.set(item.id, { title: copy.title, body: bodyWithContext(copy.body) });
      } else if (change) {
        const schedule = change.startsAt?.toLocaleString("ko-KR", {
          timeZone: "Asia/Seoul",
          month: "long",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
        result.set(item.id, {
          title: change.kind === "cancel" ? "참가할 모임이 취소됐어요" : "모임 일정이 변경됐어요",
          body: bodyWithContext(
            (schedule ? schedule + " · " : "") + notificationSnippet(change.reason, 90),
          ),
        });
      } else if (item.dedupeKey.startsWith("waitlist:"))
        result.set(item.id, {
          title: "기다리던 모임에 자리가 생겼어요",
          body: bodyWithContext("내 참가 내역에서 신청 기한을 확인해주세요."),
        });
    } else if (item.kind === "subscription" || item.kind === "subscriptions") {
      result.set(item.id, {
        title: "관심 있는 새 모임이 열렸어요",
        body: bodyWithContext(
          [post?.location, post?.date, post?.fee].filter(Boolean).join(" · ") ||
            "일정과 참가 조건을 확인해보세요.",
        ),
      });
    } else if (item.kind === "reminder" || item.kind === "reminders") {
      result.set(item.id, {
        title: item.dedupeKey.endsWith(":2h")
          ? "참가할 모임이 곧 시작돼요"
          : "참가할 모임이 하루 안에 시작돼요",
        body: bodyWithContext(item.body),
      });
    }
  }
  return result;
}
