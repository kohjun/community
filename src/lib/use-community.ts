"use client";
import { previewPost } from "@/domain/discussions";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CommunityComment,
  CommunityDetail,
  CommunityPost,
  CommunitySnapshot,
  FeedQuery,
  CommentMutation,
  InboxPage,
  ReadReceipt,
} from "@/domain/community";
import type { CursorPage, PublicImage } from "@/domain/contracts";
import type { CreateCommentInput, CreatePostInput } from "@/domain/validation";
import { createPostAction, deletePostAction, updatePostAction } from "@/app/actions";
import {
  applyCommentMutation,
  applyReadReceipt,
  mergeById,
  mergeComments,
  reconcilePosts,
  reconcileDetail,
  type CommentChange,
  matchesPostQuery,
  type PostChange,
} from "./community-state";

import { actionData, communityRequest as request } from "./api-client";
import { openPostContent, recordPostVisit } from "./post-navigation";
import { communityLocationUrl } from "@/domain/community-location";
import { markPostRead, normalizeReadPostId } from "./read-posts";
import { adoptServerRankingAnchor } from "./ranking-anchor";

const queryString = (query: FeedQuery) =>
  new URLSearchParams(
    Object.entries(query)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  ).toString();

export function useCommunity(
  initial: CommunitySnapshot,
  query: FeedQuery,
  {
    initialDetail,
    detailOnly = false,
    onRankingAnchor,
  }: {
    initialDetail?: CommunityDetail;
    detailOnly?: boolean;
    onRankingAnchor?: (rankingAt: string) => void;
  } = {},
) {
  const rankingAnchorListener = useRef(onRankingAnchor);
  rankingAnchorListener.current = onRankingAnchor;
  const currentQuery = useRef(query);
  currentQuery.current = query;
  const adoptedRankingKey = useRef<string | null>(null);
  const [snapshot, setSnapshot] = useState(initial);
  const [detail, setDetail] = useState<CommunityDetail | null>(initialDetail ?? null);
  const [error, setError] = useState("");
  const [feedError, setFeedError] = useState("");
  const [loadingPost, setLoadingPost] = useState(false);
  const [postError, setPostError] = useState("");
  const postController = useRef<AbortController | null>(null);
  useEffect(() => () => postController.current?.abort(), []);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [replyCursors, setReplyCursors] = useState<Record<string, string | null>>({});
  const commentLock = useRef(false);
  const commentVersion = useRef(0);
  const notificationVersion = useRef(0);
  const notificationLock = useRef(false);
  const lock = useRef(false);
  const filterKey = queryString({ ...query, limit: 20 });
  const [pageSelection, setPageSelection] = useState({
    filterKey,
    page: initial.pagination?.page ?? 1,
  });
  // A different search/category/sort starts at page one without requesting the old page first.
  const requestedPage = pageSelection.filterKey === filterKey ? pageSelection.page : 1;
  const key = `${filterKey}&page=${requestedPage}`;
  const restorePage = useRef<number | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  useEffect(() => {
    const restore = () => {
      const n = Number(new URLSearchParams(window.location.search).get("page"));
      restorePage.current = Number.isInteger(n) && n > 0 ? n : 1;
      setHistoryRevision((value) => value + 1);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  useEffect(() => {
    if (detailOnly || !["/", "/stories"].includes(window.location.pathname)) return;
    if (restorePage.current !== null) {
      return;
    }
    const url = communityLocationUrl(window.location.href, query, requestedPage);
    if (url !== window.location.pathname + window.location.search + window.location.hash)
      window.history.replaceState(window.history.state, "", url);
  }, [key, detailOnly, historyRevision]);
  const currentFilterKey = useRef(filterKey);
  currentFilterKey.current = filterKey;
  const loadedFilterKey = useRef(filterKey);
  const currentKey = useRef(key);
  currentKey.current = key;
  const feedVersion = useRef(0);
  const detailVersion = useRef(0);
  const postMutationVersion = useRef(0);
  const postChanges = useRef(new Map<string, PostChange>());
  const commentChanges = useRef(new Map<string, CommentChange>());
  const highlightsVersion = useRef(0);
  const loadedKey = useRef(key);
  useEffect(() => {
    const restored = restorePage.current;
    restorePage.current = null;
    setPageSelection((current) =>
      restored !== null
        ? { filterKey, page: restored }
        : current.filterKey === filterKey
          ? current
          : { filterKey, page: 1 },
    );
  }, [filterKey, historyRevision]);
  useEffect(() => {
    if (detailOnly) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (document.hidden || lock.current) return;
      const version = postMutationVersion.current;
      const requestVersion = ++highlightsVersion.current;
      void request<{ featured: CommunityPost[]; hot: CommunityPost[] }>(
        "/highlights",
        "GET",
        undefined,
        controller.signal,
      )
        .then((value) => {
          if (
            !controller.signal.aborted &&
            requestVersion === highlightsVersion.current &&
            version === postMutationVersion.current
          )
            setSnapshot((current) => ({ ...current, ...value }));
        })
        .catch(() => {});
    }, 60000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (detailOnly) return;
    const version = ++feedVersion.current;
    const keyAtRequest = currentKey.current;
    const filterAtRequest = currentFilterKey.current;
    const inboxAtRequest = notificationVersion.current;
    const postsAtRequest = postMutationVersion.current;
    const next = await request<CommunitySnapshot>(`?${keyAtRequest}`, "GET", undefined, signal);
    if (version !== feedVersion.current || keyAtRequest !== currentKey.current) return;
    ++highlightsVersion.current;
    setFeedError("");
    const anchoredQuery = rankingAnchorListener.current
      ? adoptServerRankingAnchor(currentQuery.current, next.rankingAt)
      : null;
    if (anchoredQuery?.rankingAt) {
      const anchoredFilterKey = queryString({ ...anchoredQuery, limit: 20 });
      const page = Number(new URLSearchParams(keyAtRequest).get("page") ?? 1);
      loadedKey.current = anchoredFilterKey + "&page=" + page;
      loadedFilterKey.current = anchoredFilterKey;
      adoptedRankingKey.current = loadedKey.current;
      setPageSelection({ filterKey: anchoredFilterKey, page });
      rankingAnchorListener.current?.(anchoredQuery.rankingAt);
    } else {
      loadedKey.current = keyAtRequest;
      loadedFilterKey.current = filterAtRequest;
    }
    const changes = new Map(
      [...postChanges.current].filter(([, change]) => change.version > postsAtRequest),
    );
    const requestQuery = Object.fromEntries(new URLSearchParams(keyAtRequest)) as FeedQuery;
    setSnapshot((previous) => ({
      ...next,
      featured: reconcilePosts(next.featured, changes).filter((post) => post.featured),
      hot: reconcilePosts(next.hot ?? [], changes),
      upcoming: reconcilePosts(next.upcoming ?? [], changes),
      unreadCount:
        inboxAtRequest === notificationVersion.current ? next.unreadCount : previous.unreadCount,
      notifications: previous.notifications,
      notificationNextCursor: previous.notificationNextCursor,
      posts: reconcilePosts(next.posts, changes, requestQuery),
    }));
  }, []);

  useEffect(() => {
    if (detailOnly) return;
    const adopted = adoptedRankingKey.current;
    adoptedRankingKey.current = null;
    if (adopted === key) {
      // The first response already contains this page at the server-issued anchor.
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setFeedError("");
    const timer = setTimeout(() => {
      setLoading(true);
      void refresh(controller.signal)
        .catch((e) => {
          if (!controller.signal.aborted)
            setFeedError(e instanceof Error ? e.message : "이야기를 불러오지 못했어요.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, refresh, detailOnly]);
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(""), 6000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  function retryFeed() {
    if (detailOnly || lock.current || loading) return;
    const retryKey = currentKey.current;
    setFeedError("");
    setLoading(true);
    void refresh()
      .catch((error: unknown) => {
        if (retryKey === currentKey.current)
          setFeedError(error instanceof Error ? error.message : "이야기를 불러오지 못했어요.");
      })
      .finally(() => {
        if (retryKey === currentKey.current) setLoading(false);
      });
  }

  async function mutate<T>(
    work: () => Promise<T>,
    apply?: (value: T) => void,
    refreshFeed = true,
  ): Promise<boolean> {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await work();
      apply?.(result);
      if (refreshFeed)
        try {
          await refresh();
        } catch {
          setError("저장은 완료됐지만 목록을 새로 불러오지 못했어요. 새로고침해주세요.");
        }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청에 실패했어요.");
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function updatePost(post: CommunityPost) {
    const version = ++postMutationVersion.current;
    postChanges.current.set(post.id, { version, post });
    setDetail((current) => (current?.post.id === post.id ? { ...current, post } : current));
    const preview = previewPost(post);
    setSnapshot((current) => ({
      ...current,
      posts: current.posts
        .map((p) => (p.id === post.id ? preview : p))
        .filter(
          (p) =>
            p.id !== post.id ||
            matchesPostQuery(
              p,
              Object.fromEntries(new URLSearchParams(currentKey.current)) as FeedQuery,
            ),
        ),
      hot: (current.hot ?? []).map((p) =>
        p.id === post.id
          ? {
              ...preview,
              ...(p.popularityScore !== undefined ? { popularityScore: p.popularityScore } : {}),
            }
          : p,
      ),
      upcoming: (current.upcoming ?? []).map((p) => (p.id === post.id ? preview : p)),
      featured: current.featured.map((p) => (p.id === post.id ? preview : p)),
    }));
  }
  async function loadPost(id: string) {
    const version = ++detailVersion.current;
    postController.current?.abort();
    const controller = new AbortController();
    postController.current = controller;
    setLoadingPost(true);
    setPostError("");
    setDetail(null);
    const postsAtRequest = postMutationVersion.current,
      commentsAtRequest = commentVersion.current;
    try {
      const fresh = await openPostContent(id, controller.signal, {
        isCurrent: () => version === detailVersion.current,
        reconcile: (result) =>
          reconcileDetail(
            result,
            new Map(
              [...postChanges.current].filter(([, change]) => change.version > postsAtRequest),
            ),
            new Map(
              [...commentChanges.current].filter(
                ([, change]) => change.version > commentsAtRequest,
              ),
            ),
          ),
        display: (value) => {
          setDetail(value);
          setReplyCursors({});
          updatePost(value.post);
        },
      });
      if (!fresh) return false;
      const visitAtRequest = postMutationVersion.current;
      void recordPostVisit(id, controller.signal).then((post) => {
        if (
          post &&
          !controller.signal.aborted &&
          version === detailVersion.current &&
          visitAtRequest === postMutationVersion.current
        )
          updatePost(post);
      });
      return true;
    } catch (e) {
      if (version === detailVersion.current && !controller.signal.aborted)
        setPostError(e instanceof Error ? e.message : "게시글을 불러오지 못했어요.");
      return false;
    } finally {
      if (version === detailVersion.current) setLoadingPost(false);
    }
  }
  useEffect(() => {
    if (!initialDetail) return;
    const id = normalizeReadPostId(initialDetail.post.id);
    if (!id) return;
    markPostRead(id);
    const controller = new AbortController();
    const version = detailVersion.current;
    const postsAtRequest = postMutationVersion.current;
    void recordPostVisit(id, controller.signal).then((post) => {
      if (
        post &&
        !controller.signal.aborted &&
        version === detailVersion.current &&
        postsAtRequest === postMutationVersion.current
      )
        updatePost(post);
    });
    return () => controller.abort();
  }, [initialDetail?.post.id]);

  function closePost() {
    ++detailVersion.current;
    postController.current?.abort();
    setLoadingPost(false);
    setPostError("");
    setDetail(null);
  }

  async function loadComments(parentId: string | null = null) {
    if (!detail || commentLock.current || lock.current) return;
    const postId = detail.post.id,
      version = detailVersion.current,
      commentsAtRequest = commentVersion.current;
    const cursor = parentId ? replyCursors[parentId] : detail.nextCommentCursor;
    if ((!parentId || Object.hasOwn(replyCursors, parentId)) && cursor === null) return;
    const params = new URLSearchParams({
      ...(parentId ? { parentId } : {}),
      ...(cursor ? { cursor } : {}),
    });
    commentLock.current = true;
    setLoadingComments(true);
    try {
      const page = await request<CursorPage<CommunityComment>>(
        `/posts/${postId}/comments?${params}`,
      );
      if (version !== detailVersion.current || commentsAtRequest !== commentVersion.current) return;
      setDetail((current) =>
        current?.post.id === postId
          ? {
              ...current,
              comments: mergeComments(current.comments, page.items),
              nextCommentCursor: parentId ? current.nextCommentCursor : page.nextCursor,
            }
          : current,
      );
      if (parentId) setReplyCursors((current) => ({ ...current, [parentId]: page.nextCursor }));
    } catch (e) {
      if (version === detailVersion.current)
        setError(e instanceof Error ? e.message : "댓글을 불러오지 못했어요.");
    } finally {
      commentLock.current = false;
      setLoadingComments(false);
    }
  }

  async function loadNotifications(append = false) {
    if (append && (notificationLock.current || !snapshot.notificationNextCursor)) return;
    const version = ++notificationVersion.current;
    notificationLock.current = true;
    setLoadingNotifications(true);
    try {
      const page = await request<InboxPage>(
        `/notifications${append ? `?cursor=${snapshot.notificationNextCursor}` : ""}`,
      );
      if (version !== notificationVersion.current) return;
      setSnapshot((current) => ({
        ...current,
        notifications: append ? mergeById(current.notifications, page.items) : page.items,
        notificationNextCursor: page.nextCursor,
        unreadCount: page.unreadCount,
      }));
    } catch (e) {
      if (version === notificationVersion.current)
        setError(e instanceof Error ? e.message : "알림을 불러오지 못했어요.");
    } finally {
      if (version === notificationVersion.current) {
        notificationLock.current = false;
        setLoadingNotifications(false);
      }
    }
  }
  function receiveComment(result: CommentMutation) {
    const version = ++commentVersion.current;
    for (const comment of [result.comment, ...(result.parent ? [result.parent] : [])])
      commentChanges.current.set(comment.id, { version, comment });
    setDetail((current) => applyCommentMutation(current, result));
    updatePost(result.post);
  }
  function receiveRead(receipt: ReadReceipt) {
    // Discard older in-flight inbox pages rather than resurrecting unread badges.
    ++notificationVersion.current;
    notificationLock.current = false;
    setLoadingNotifications(false);
    setSnapshot((current) => ({
      ...current,
      notifications: applyReadReceipt(current.notifications, receipt),
      unreadCount: receipt.unreadCount,
    }));
  }

  const posts = useMemo(
    () => [
      ...new Map(
        [
          ...snapshot.posts,
          ...snapshot.featured,
          ...(snapshot.hot ?? []),
          ...(snapshot.upcoming ?? []),
          ...(detail ? [previewPost(detail.post)] : []),
        ].map((p) => [p.id, p]),
      ).values(),
    ],
    [snapshot, detail],
  );
  return {
    posts,
    hot: snapshot.hot ?? [],
    upcoming: snapshot.upcoming ?? [],
    feedPosts: loadedFilterKey.current === filterKey ? snapshot.posts : [],
    featured: snapshot.featured,
    comments: detail?.comments ?? [],
    notifications: snapshot.notifications,
    liked: posts.filter((p) => p.isLiked).map((p) => p.id),
    bookmarked: posts.filter((p) => p.isBookmarked).map((p) => p.id),
    canWrite: snapshot.canWrite,
    mode: snapshot.mode,
    loading,
    busy,
    error,
    feedError,
    retryFeed,
    pagination: loadedFilterKey.current === filterKey ? (snapshot.pagination ?? null) : null,
    changePage: (nextPage: number) => {
      const pagination = snapshot.pagination;
      if (
        lock.current ||
        loading ||
        !pagination ||
        loadedFilterKey.current !== currentFilterKey.current ||
        !Number.isInteger(nextPage) ||
        nextPage < 1 ||
        nextPage > pagination.totalPages
      )
        return;
      setError("");
      setFeedError("");
      if (nextPage === requestedPage && loadedKey.current !== currentKey.current) {
        // Keep the previous page usable when a page request fails; the same button retries.
        retryFeed();
      } else {
        setPageSelection({ filterKey: currentFilterKey.current, page: nextPage });
      }
    },
    loadPost,
    closePost,
    loadingPost,
    postError,
    detailPost: detail?.post ?? null,
    interestFeed: snapshot.interestFeed,
    acceptedAnswer: detail?.post.acceptedAnswerId
      ? (detail.comments.find(
          (comment) => comment.id === detail.post.acceptedAnswerId && !comment.isDeleted,
        ) ??
        (detail.acceptedAnswer?.id === detail.post.acceptedAnswerId ? detail.acceptedAnswer : null))
      : null,
    resolveQuestion: (id: string, commentId: string | null, expectedUpdatedAt: string) =>
      mutate(
        () =>
          request<CommunityDetail>(`/posts/${id}/resolve`, "POST", {
            commentId,
            expectedUpdatedAt,
          }),
        (result) => {
          updatePost(result.post);
          setDetail((current) =>
            current?.post.id === id
              ? { ...current, acceptedAnswer: result.acceptedAnswer ?? null }
              : current,
          );
        },
      ),
    loadComments,
    loadingComments,
    loadingNotifications,
    replyCursors,
    nextCommentCursor: detail?.nextCommentCursor ?? null,
    unreadCount: snapshot.unreadCount,
    notificationNextCursor: snapshot.notificationNextCursor,
    addPost: (input: CreatePostInput) =>
      mutate(() => actionData(() => createPostAction(input)), updatePost),
    editPost: (id: string, input: CreatePostInput, expectedUpdatedAt: string) =>
      mutate(
        () => actionData(() => updatePostAction(id, { ...input, expectedUpdatedAt })),
        updatePost,
      ),
    deletePost: (id: string) =>
      mutate(
        () => actionData(() => deletePostAction(id)),
        () => {
          const version = ++postMutationVersion.current;
          postChanges.current.set(id, { version, post: null });
          ++detailVersion.current;
          setDetail((current) => (current?.post.id === id ? null : current));
          setSnapshot((s) => ({
            ...s,
            posts: s.posts.filter((p) => p.id !== id),
            featured: s.featured.filter((p) => p.id !== id),
            hot: (s.hot ?? []).filter((p) => p.id !== id),
            upcoming: (s.upcoming ?? []).filter((p) => p.id !== id),
          }));
        },
      ),
    addComment: (input: CreateCommentInput) =>
      mutate(() => request<CommentMutation>("/comments", "POST", input), receiveComment, false),
    editComment: (id: string, bodyMarkdown: string) =>
      mutate(
        () => request<CommentMutation>(`/comments/${id}`, "PATCH", { bodyMarkdown }),
        receiveComment,
        false,
      ),
    deleteComment: (id: string) =>
      mutate(() => request<CommentMutation>(`/comments/${id}`, "DELETE"), receiveComment, false),
    vote: (id: string, optionIndex: number) =>
      mutate(
        () => request<CommunityPost>(`/posts/${id}/vote`, "POST", { optionIndex }),
        updatePost,
        false,
      ),
    toggleLike: (id: string) =>
      mutate(
        () =>
          request<CommunityPost>(`/posts/${id}/like`, "POST", {
            active: !posts.find((p) => p.id === id)?.isLiked,
          }),
        updatePost,
        false,
      ),
    toggleBookmark: (id: string) =>
      mutate(
        () =>
          request<CommunityPost>(`/posts/${id}/bookmark`, "POST", {
            active: !posts.find((p) => p.id === id)?.isBookmarked,
          }),
        updatePost,
        false,
      ),
    markAllRead: () =>
      mutate(() => request<ReadReceipt>("/notifications/read", "POST", {}), receiveRead, false),
    markRead: (id: string) =>
      mutate(() => request<ReadReceipt>("/notifications/read", "POST", { id }), receiveRead, false),
    refreshNotifications: () => loadNotifications(),
    loadMoreNotifications: () => loadNotifications(true),
    upload: async (file: File): Promise<PublicImage> => {
      const body = new FormData();
      body.append("file", file);
      return request<PublicImage>("/uploads", "POST", body);
    },
  };
}
