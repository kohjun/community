"use client";
import { DISCUSSION_LABELS, safePostTitle, safeSpoilerSummary } from "@/domain/discussions";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Bookmark, Heart, Send, UserRound, X } from "lucide-react";
import Link from "next/link";
import { PostLibraryLinks } from "./library-collaboration";
import { RecordBacklink } from "./record-discovery";
import dynamic from "next/dynamic";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";
import { Markdown } from "./markdown";
import { PostBody } from "./post-body";
import { PollCard } from "./poll-card";
import { SafetyActions } from "./safety-actions";
import { PostShareButton } from "./post-share-button";
import { RecruitmentApplyButton, RecruitmentCta } from "./recruitment-cta";
import { CATEGORIES } from "@/domain/categories";
import { createCommentSchema } from "@/domain/validation";
import type { CommunityComment, CommunityPost } from "@/domain/community";
import type { useCommunity } from "@/lib/use-community";
import { notifyPushOnboardingMoment } from "@/lib/push-onboarding-events";
const WriteDialog = dynamic(() => import("./write-dialog").then((module) => module.WriteDialog), {
  ssr: false,
});
function commentDepth(comment: CommunityComment, byId: Map<string, CommunityComment>) {
  const visited = new Set<string>([comment.id]);
  let parentId = comment.parentId;
  let depth = 0;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    depth++;
    parentId = parent.parentId;
  }
  return depth;
}

function threadOrder(comments: CommunityComment[]) {
  const children = new Map<string | null, CommunityComment[]>();
  for (const comment of comments)
    children.set(comment.parentId, [...(children.get(comment.parentId) ?? []), comment]);
  const stack = [...(children.get(null) ?? [])].reverse();
  const ordered: CommunityComment[] = [];
  const seen = new Set<string>();
  while (stack.length) {
    const item = stack.pop()!;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    ordered.push(item);
    stack.push(...[...(children.get(item.id) ?? [])].reverse());
  }
  return ordered;
}

export function PostDetailContent({
  post: active,
  store,
  presentation = "dialog",
  onUnavailable,
}: {
  post: CommunityPost;
  store: ReturnType<typeof useCommunity>;
  presentation?: "dialog" | "page";
  onUnavailable: () => void;
}) {
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const concealed = !!active.spoiler && revealedId !== active.id;
  const Title = presentation === "dialog" ? DialogTitle : "h1";
  const Description = presentation === "dialog" ? DialogDescription : "div";
  const label = (slug: CommunityPost["category"]) =>
    CATEGORIES.find((item) => item.slug === slug)?.name ?? "이야기";
  const [replyTo, setReplyTo] = useState<CommunityComment | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [commentAnonymous, setCommentAnonymous] = useState(true);
  const [commentError, setCommentError] = useState("");
  const [editingPost, setEditingPost] = useState<CommunityPost | null>(null);
  const [writing, setWriting] = useState(false);
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [editCommentBody, setEditCommentBody] = useState("");
  const [deleting, setDeleting] = useState<{ type: "post" | "comment"; id: string } | null>(null);
  const [toast, setToast] = useState("");
  const commentInput = useRef<HTMLTextAreaElement>(null);
  const activeComments = threadOrder(store.comments.filter((item) => item.postId === active.id));
  const commentsById = new Map(activeComments.map((item) => [item.id, item]));
  const loadedReplyCounts = new Map<string, number>();
  for (const item of activeComments)
    if (item.parentId)
      loadedReplyCounts.set(item.parentId, (loadedReplyCounts.get(item.parentId) ?? 0) + 1);
  useEffect(() => {
    let seconds = 0;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (++seconds >= 60) {
        clearInterval(timer);
        notifyPushOnboardingMoment("content");
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [active.id]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(timer);
  }, [toast]);
  async function savePost(id: string) {
    const wasSaved = store.bookmarked.includes(id);
    if (await store.toggleBookmark(id)) {
      setToast(wasSaved ? "북마크를 해제했어요." : "북마크에 담았어요.");
      if (!wasSaved) notifyPushOnboardingMoment("bookmark");
    }
  }
  async function submitComment(event: FormEvent) {
    event.preventDefault();
    const parsed = createCommentSchema.safeParse({
      postId: active.id,
      parentId: replyTo?.id ?? null,
      bodyMarkdown: commentBody,
      isAnonymous: commentAnonymous,
    });
    if (!parsed.success) {
      setCommentError("댓글을 1~5,000자 사이로 입력해주세요.");
      return;
    }
    if (!(await store.addComment(parsed.data))) return;
    setCommentBody("");
    setReplyTo(null);
    setCommentError("");
    setToast("댓글을 남겼어요.");
  }
  return (
    <>
      <div className="detail-overline">
        <span>{label(active.category)}</span>
        <span className="kind-badge">
          {active.kind === "모집" && active.eventCancelledAt ? "모집 취소" : active.kind}
        </span>
        {active.verifiedParticipation && (
          <span className="verified-review-badge">
            QR 참가 인증 · {active.verifiedParticipation.rating}점
          </span>
        )}
        {active.sample && <span className="preview-pill">예시 콘텐츠</span>}
      </div>
      <div className="detail-title-row">
        <Title className="detail-title">{concealed ? safePostTitle(active) : active.title}</Title>
        {active.kind === "모집" && (
          <RecruitmentApplyButton
            postId={active.id}
            url={active.applicationUrl}
            cancelledAt={active.eventCancelledAt}
          />
        )}
      </div>
      <Description className="detail-author">
        <span className="avatar">
          <UserRound size={20} />
        </span>
        <span>
          <strong>{active.author}</strong>
          <small>
            {active.time} · 조회 {active.views}
          </small>
        </span>
      </Description>
      {active.isMine && (
        <div className="owner-actions">
          <Button
            size="sm"
            variant="ghost"
            disabled={store.busy || !store.canWrite}
            onClick={() => {
              setEditingPost(active);
              setWriting(true);
            }}
          >
            글 수정
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="danger-text"
            disabled={store.busy || !store.canWrite}
            onClick={() => setDeleting({ type: "post", id: active.id })}
          >
            글 삭제
          </Button>
        </div>
      )}
      {active.verifiedParticipation && (
        <div className="ops-actions">
          <RecordBacklink postId={active.verifiedParticipation.eventPostId} />
          <Link
            className="participation-secondary"
            href={`/events/${active.verifiedParticipation.eventPostId}`}
          >
            {active.verifiedParticipation.eventTitle}
          </Link>
          {active.verifiedParticipation.hostPublicId && (
            <Link
              className="participation-secondary"
              href={`/players/${active.verifiedParticipation.hostPublicId}`}
            >
              호스트 프로필
            </Link>
          )}
          {active.verifiedParticipation.templateEntryId && (
            <Link
              className="participation-secondary"
              href={`/archive/${active.verifiedParticipation.templateEntryId}`}
            >
              이벤트 템플릿
            </Link>
          )}
        </div>
      )}
      {active.kind === "이야기" && (
        <div className="question-status">
          <span>{DISCUSSION_LABELS[active.discussionType ?? "free"]}</span>
          {active.discussionType === "question" && (
            <>
              <strong>{active.acceptedAnswerId ? "해결된 질문" : "답변을 기다리고 있어요"}</strong>
              {active.isMine && active.acceptedAnswerId && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={store.busy}
                  onClick={() => store.resolveQuestion(active.id, null, active.updatedAt)}
                >
                  채택 해제
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {concealed ? (
        <section className="spoiler-gate">
          <strong>이 글에는 스포일러가 있어요</strong>
          <p>{safeSpoilerSummary(active)}</p>
          <Button onClick={() => setRevealedId(active.id)}>본문과 댓글 펼쳐보기</Button>
        </section>
      ) : (
        <>
          <PostBody
            document={active.bodyDocument ?? null}
            body={active.body}
            images={active.images}
            videos={active.videos ?? []}
          />
          {(active.category === "knowledge" || active.category === "lab") && (
            <PostLibraryLinks postId={active.id} enabled={store.canWrite} />
          )}
          {active.kind === "모집" && <RecruitmentCta post={active} />}
          {active.poll && (
            <PollCard
              poll={active.poll}
              canVote={store.canWrite}
              busy={store.busy}
              onVote={(index) => store.vote(active.id, index)}
            />
          )}
          {active.tags.length > 0 && (
            <div className="detail-tags">
              {active.tags.map((value) => (
                <span key={value}>#{value}</span>
              ))}
            </div>
          )}
        </>
      )}
      <SafetyActions
        targetType="post"
        targetId={active.id}
        isMine={active.isMine}
        canAct={store.canWrite}
        onBlocked={() => {
          onUnavailable();
        }}
      />
      <div className="detail-reactions">
        <PostShareButton postId={active.id} title={safePostTitle(active)} />
        <Button
          variant="outline"
          disabled={store.busy || !store.canWrite}
          aria-pressed={active.isLiked}
          onClick={() => store.toggleLike(active.id)}
        >
          <Heart size={17} fill={active.isLiked ? "currentColor" : "none"} />
          좋아요 {active.likes}
        </Button>
        <Button
          variant="outline"
          disabled={store.busy || !store.canWrite}
          aria-pressed={active.isBookmarked}
          onClick={() => savePost(active.id)}
        >
          <Bookmark size={17} fill={active.isBookmarked ? "currentColor" : "none"} />
          {active.isBookmarked ? "저장됨" : "북마크"}
        </Button>
      </div>
      {!concealed && (
        <div className="comments-section">
          {store.acceptedAnswer && (
            <section className="accepted-answer">
              <strong>글쓴이가 채택한 답변 · {store.acceptedAnswer.author}</strong>
              <Markdown>{store.acceptedAnswer.body}</Markdown>
            </section>
          )}
          <h3>
            함께 나누는 이야기 <span>{active.comments}</span>
          </h3>
          {activeComments.map((item) => (
            <div
              id={`comment-${item.id}`}
              className={active.acceptedAnswerId === item.id ? "comment is-accepted" : "comment"}
              key={item.id}
              style={{
                marginLeft: `${Math.min(commentDepth(item, commentsById), 3) * 14}px`,
              }}
            >
              <span className="comment-avatar">
                <UserRound size={17} />
              </span>
              <div className="comment-copy">
                <div className="comment-byline">
                  <strong>{item.author}</strong>
                  <span>{item.time}</span>
                </div>
                {item.parentId && (
                  <span className="reply-context">
                    ↳ {commentsById.get(item.parentId)?.author ?? "삭제된 댓글"}에 답글
                  </span>
                )}
                {editingComment === item.id ? (
                  <form
                    className="comment-edit"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (await store.editComment(item.id, editCommentBody)) {
                        setEditingComment(null);
                        setToast("댓글을 수정했어요.");
                      }
                    }}
                  >
                    <textarea
                      aria-label="댓글 수정 내용"
                      value={editCommentBody}
                      onChange={(event) => setEditCommentBody(event.target.value)}
                      maxLength={5000}
                      rows={3}
                      required
                    />
                    <div className="owner-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingComment(null)}
                        disabled={store.busy || !store.canWrite}
                      >
                        취소
                      </Button>
                      <Button type="submit" size="sm" disabled={store.busy || !store.canWrite}>
                        수정 저장
                      </Button>
                    </div>
                  </form>
                ) : (
                  <Markdown>{item.body}</Markdown>
                )}
                {!item.isDeleted && (
                  <div className="comment-actions">
                    {active.discussionType === "question" && active.isMine && !item.isMine && (
                      <button
                        className="reply-button"
                        disabled={store.busy || !store.canWrite}
                        onClick={() =>
                          store.resolveQuestion(
                            active.id,
                            active.acceptedAnswerId === item.id ? null : item.id,
                            active.updatedAt,
                          )
                        }
                      >
                        {active.acceptedAnswerId === item.id ? "채택 해제" : "답변 채택"}
                      </button>
                    )}
                    <button
                      className="reply-button"
                      disabled={!store.canWrite || store.busy}
                      onClick={() => {
                        setReplyTo(item);
                        commentInput.current?.focus();
                      }}
                    >
                      답글 쓰기
                    </button>
                    <SafetyActions
                      targetType="comment"
                      targetId={item.id}
                      isMine={item.isMine}
                      canAct={store.canWrite}
                      onBlocked={() => {
                        void store.loadPost(active.id);
                        store.retryFeed();
                      }}
                    />
                    {item.isMine && (
                      <>
                        <button
                          className="reply-button"
                          disabled={store.busy || !store.canWrite}
                          onClick={() => {
                            setEditingComment(item.id);
                            setEditCommentBody(item.body);
                          }}
                        >
                          댓글 수정
                        </button>
                        <button
                          className="reply-button danger-text"
                          disabled={store.busy || !store.canWrite}
                          onClick={() => setDeleting({ type: "comment", id: item.id })}
                        >
                          댓글 삭제
                        </button>
                      </>
                    )}
                  </div>
                )}
                {item.replyCount > (loadedReplyCounts.get(item.id) ?? 0) &&
                  store.replyCursors[item.id] !== null && (
                    <button
                      className="reply-button load-replies"
                      disabled={store.busy || store.loadingComments}
                      onClick={() => store.loadComments(item.id)}
                    >
                      {Object.hasOwn(store.replyCursors, item.id)
                        ? "답글 더 보기"
                        : `답글 ${item.replyCount}개 보기`}
                    </button>
                  )}
              </div>
            </div>
          ))}
          {store.loadingComments && (
            <p className="feed-status" role="status">
              댓글을 불러오는 중이에요.
            </p>
          )}
          {store.nextCommentCursor && (
            <Button
              className="load-more"
              variant="outline"
              disabled={store.busy || store.loadingComments}
              onClick={() => store.loadComments()}
            >
              댓글 더 보기
            </Button>
          )}
          <form className="comment-form" onSubmit={submitComment}>
            {replyTo && (
              <div className="replying-to">
                {replyTo.author}님에게 답글
                <button type="button" onClick={() => setReplyTo(null)} aria-label="답글 취소">
                  <X size={15} />
                </button>
              </div>
            )}
            <textarea
              aria-label="댓글 내용"
              ref={commentInput}
              disabled={!store.canWrite || store.busy}
              value={commentBody}
              onChange={(event) => setCommentBody(event.target.value)}
              placeholder="함께 나누고 싶은 이야기를 남겨주세요."
              maxLength={5000}
              rows={3}
            />
            <div className="comment-form-bottom">
              <label>
                <input
                  type="checkbox"
                  checked={commentAnonymous}
                  onChange={(event) => setCommentAnonymous(event.target.checked)}
                />
                익명으로 남기기
              </label>
              <Button disabled={store.busy || !store.canWrite} size="sm" type="submit">
                <Send size={14} />
                댓글 등록
              </Button>
            </div>
            {commentError && (
              <p className="form-error" role="alert">
                {commentError}
              </p>
            )}
          </form>
          <p className="local-only-note">
            {store.canWrite ? (
              "익명으로 남겨도 작성자 본인만 수정·삭제할 수 있어요."
            ) : (
              <Link href={"/login?next=/posts/" + active.id}>로그인하고 이야기를 나눠보세요.</Link>
            )}
          </p>
        </div>
      )}
      {writing && editingPost && (
        <WriteDialog
          key={editingPost.id}
          open={writing}
          onOpenChange={setWriting}
          initialCategory={editingPost.category}
          post={editingPost}
          upload={store.upload}
          onPublish={async (input) => {
            if (!(await store.editPost(editingPost.id, input, editingPost.updatedAt))) return false;
            setWriting(false);
            setToast("글을 수정했어요.");
            return true;
          }}
        />
      )}
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !store.busy) setDeleting(null);
        }}
      >
        <DialogContent className="utility-dialog">
          <DialogTitle className="utility-title">
            {deleting?.type === "post" ? "게시글을 삭제할까요?" : "댓글을 삭제할까요?"}
          </DialogTitle>
          <DialogDescription className="utility-description">
            {deleting?.type === "post"
              ? "삭제한 글은 목록에서 사라지며 복구할 수 없어요."
              : "댓글 내용은 삭제되고, 이미 달린 답글은 유지돼요."}
          </DialogDescription>
          <div className="owner-actions">
            <Button
              variant="outline"
              disabled={store.busy || !store.canWrite}
              onClick={() => setDeleting(null)}
            >
              취소
            </Button>
            <Button
              className="danger-button"
              disabled={store.busy || !store.canWrite}
              onClick={async () => {
                if (!deleting) return;
                const ok =
                  deleting.type === "post"
                    ? await store.deletePost(deleting.id)
                    : await store.deleteComment(deleting.id);
                if (ok) {
                  if (deleting.type === "post") onUnavailable();
                  setDeleting(null);
                  setReplyTo(null);
                  setToast("삭제했어요.");
                }
              }}
            >
              {store.busy ? "삭제 중…" : "삭제하기"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {toast && (
        <p className="post-detail-status" role="status">
          {toast}
        </p>
      )}
    </>
  );
}
