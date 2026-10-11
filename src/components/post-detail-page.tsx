"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, UserCircle } from "lucide-react";
import type { CommunitySnapshot, CommunityDetail } from "@/domain/community";
import { useCommunity } from "@/lib/use-community";
import { PostDetailContent } from "./post-detail-content";
import { AdSlot } from "./ad-slot";
import { SiteNavigation } from "./site-navigation";
import { NotificationBell } from "./notification-bell";
import { TestAccountControls } from "./test-account-controls";
import { Button } from "./ui/button";

export function PostDetailPage({
  initialState,
  initialDetail,
}: {
  initialState: CommunitySnapshot;
  initialDetail: CommunityDetail;
}) {
  const store = useCommunity(initialState, {}, { initialDetail, detailOnly: true });
  const [unavailable, setUnavailable] = useState(false);
  const post = store.detailPost;
  return (
    <>
      <a className="skip-link" href="#post-content">
        본문으로 바로가기
      </a>
      <header className="site-header">
        <div className="header-inner post-page-header">
          <Link className="brand" href="/" aria-label="Sliper 홈">
            <img src="/images/sliper-logo.png" alt="" />
            <span>
              sliper<span className="brand-dot">.</span>
            </span>
          </Link>
          <SiteNavigation />
          <div className="header-actions">
            <NotificationBell />
            <Link className="profile-button" href="/mypage" aria-label="내 정보">
              <UserCircle size={21} />
            </Link>
            <TestAccountControls fallbackLogin />
          </div>
        </div>
      </header>
      <main className="post-detail-page" id="post-content">
        <div className="post-page-breadcrumb">
          <Link href={initialDetail.post.kind === "모집" ? "/" : "/stories"}>
            <ArrowLeft size={15} /> {initialDetail.post.kind === "모집" ? "홈으로" : "이야기 목록"}
          </Link>
          <span>Sliper 커뮤니티</span>
        </div>
        <AdSlot compact />
        {unavailable ? (
          <section className="post-page-empty">
            <h1>이 글은 더 이상 볼 수 없어요.</h1>
            <p>삭제하거나 차단한 글은 목록에서 숨겨집니다.</p>
            <Link className="participation-secondary" href="/stories">
              이야기 둘러보기
            </Link>
          </section>
        ) : post ? (
          <article className="post-page-card" aria-label="게시글 상세">
            <PostDetailContent
              key={post.id}
              post={post}
              store={store}
              presentation="page"
              onUnavailable={() => {
                setUnavailable(true);
                store.closePost();
              }}
            />
          </article>
        ) : (
          <section className="post-page-empty" aria-busy={store.loadingPost}>
            <h1>{store.loadingPost ? "글을 불러오는 중이에요." : "글을 불러오지 못했어요."}</h1>
            <p>{store.postError || "잠시 후 다시 시도해주세요."}</p>
            {!store.loadingPost && (
              <Button onClick={() => store.loadPost(initialDetail.post.id)}>다시 불러오기</Button>
            )}
          </section>
        )}
        {store.error && (
          <p className="post-page-feedback" role="alert">
            {store.error}
          </p>
        )}
      </main>
    </>
  );
}
