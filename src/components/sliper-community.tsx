"use client";
import type { FeedQuery } from "@/domain/community";
import { communityLocation } from "@/domain/community-location";
import type { PopularPeriod } from "@/domain/community-time";
import { notifyPushOnboardingMoment } from "@/lib/push-onboarding-events";

import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Zap,
  UserRound,
  FlaskConical,
  Handshake,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Compass,
  CookingPot,
  Flag,
  Flame,
  Grid2X2,
  Heart,
  Home,
  List,
  MessageCircle,
  Music2,
  PartyPopper,
  Pencil,
  Plane,
  Search,
  Shield,
  Trophy,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { PostDetailContent } from "./post-detail-content";
import dynamic from "next/dynamic";
import { LatestEventRecords } from "./record-discovery";
import { FeaturedCarousel, HotStories } from "./home-stage";
import { AdSlot } from "./ad-slot";
import { SiteNavigation } from "./site-navigation";
import { NotificationBell } from "./notification-bell";
import {
  DEFAULT_DISCOVERY_FILTERS,
  EventDiscoveryButton,
  EventDiscoveryChips,
  EventDiscoveryDialog,
  hasDiscoveryFilters,
  type EventDiscoveryFilters,
} from "./event-discovery";
import { CommunityPostRow } from "./community-post-row";
import { CommunityRecruitmentCard } from "./community-recruitment-card";
import { CommunityPagination } from "./community-pagination";
import { TestAccountControls } from "./test-account-controls";
import { PolicyLinks } from "./policy-links";
import { BOARD_TOPICS, BOARD_DESCRIPTIONS } from "@/domain/boards";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CATEGORIES, type CategorySlug } from "@/domain/categories";
import type { CommunitySnapshot } from "@/domain/community";
import { DISCUSSION_TYPES, DISCUSSION_LABELS } from "@/domain/discussions";
import { useCommunity } from "@/lib/use-community";
import { cn } from "@/lib/utils";
import {
  readRecruitmentLayout,
  writeRecruitmentLayout,
  type RecruitmentLayout,
} from "@/lib/recruitment-layout";

const WriteDialog = dynamic(() => import("./write-dialog").then((module) => module.WriteDialog), {
  ssr: false,
});

const icons: Record<CategorySlug, LucideIcon> = {
  travel: Plane,
  dating: Heart,
  race: Flag,
  "mind-games": Compass,
  survival: Shield,
  music: Music2,
  sports: Trophy,
  cooking: CookingPot,
  party: PartyPopper,
  knowledge: BookOpen,
  lab: FlaskConical,
  crew: Handshake,
};
const kinds = ["전체", "이야기", "모집", "투표"] as const;
type View = "home" | "stories" | "popular" | "bookmarks" | "mine";
type Sheet = "categories" | "guide" | null;
const label = (category: CategorySlug) => CATEGORIES.find((item) => item.slug === category)!.name;

function CategoryMenu({
  category,
  onSelect,
  className,
  label,
  showAllIcon = false,
}: {
  category: CategorySlug | "all";
  onSelect: (value: CategorySlug | "all") => void;
  className: string;
  label: string;
  showAllIcon?: boolean;
}) {
  return (
    <nav className={className} aria-label={label}>
      <button
        type="button"
        className={cn(category === "all" && "active")}
        aria-pressed={category === "all"}
        onClick={() => onSelect("all")}
      >
        {showAllIcon && <Grid2X2 size={17} strokeWidth={1.8} />}
        전체
      </button>
      {CATEGORIES.map((item) => {
        const Icon = icons[item.slug];
        return (
          <button
            type="button"
            key={item.slug}
            className={cn(category === item.slug && "active")}
            aria-pressed={category === item.slug}
            onClick={() => onSelect(item.slug)}
          >
            <Icon size={17} strokeWidth={1.8} />
            {item.name}
          </button>
        );
      })}
    </nav>
  );
}

export function SliperCommunity({
  initialState,
  initialView = "home",
  initialQuery = {},
}: {
  initialState: CommunitySnapshot;
  initialView?: "home" | "stories";
  initialQuery?: FeedQuery;
}) {
  const [view, setView] = useState<View>(
    initialQuery.view && initialQuery.view !== "home" ? initialQuery.view : initialView,
  );
  const [category, setCategory] = useState<CategorySlug | "all">(initialQuery.category ?? "all");
  const [kind, setKind] = useState<(typeof kinds)[number]>(
    initialQuery.kind === "후기"
      ? "이야기"
      : (initialQuery.kind ?? (initialView === "stories" ? "이야기" : "전체")),
  );
  const [recruitmentLayout, setRecruitmentLayout] = useState<RecruitmentLayout>("list");
  useEffect(() => {
    setRecruitmentLayout(readRecruitmentLayout());
  }, []);
  const [sort, setSort] = useState<"latest" | "popular" | "nearest">(initialQuery.sort ?? "latest");
  const [period, setPeriod] = useState<PopularPeriod>(initialQuery.period ?? "today");
  const [rankingAt, setRankingAt] = useState(initialQuery.rankingAt ?? initialState.rankingAt);
  const [discovery, setDiscovery] = useState<EventDiscoveryFilters>(DEFAULT_DISCOVERY_FILTERS);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [pendingNearest, setPendingNearest] = useState(false);
  const [query, setQuery] = useState(initialQuery.search ?? "");
  const [discussionType, setDiscussionType] = useState<FeedQuery["discussionType"]>(
    initialQuery.discussionType,
  );
  const [focus, setFocus] = useState<FeedQuery["focus"]>(initialQuery.focus ?? "all");
  const [topic, setTopic] = useState(initialQuery.topic ?? "");
  const [tag, setTag] = useState(initialQuery.tag ?? "");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [writing, setWriting] = useState(false);
  const [toast, setToast] = useState("");
  const store = useCommunity(initialState, {
    category: category === "all" ? undefined : category,
    kind: kind === "전체" ? undefined : kind,
    search: query || undefined,
    discussionType,
    focus,
    topic: topic || undefined,
    tag: tag || undefined,
    view: view === "stories" ? "home" : view,
    sort,
    period,
    rankingAt: sort === "popular" && period !== "all" ? rankingAt : undefined,
    eventOnly: discovery.eventOnly || undefined,
    meetupType: discovery.meetupType === "all" ? undefined : discovery.meetupType,
    latitude: discovery.coordinates?.latitude,
    longitude: discovery.coordinates?.longitude,
    radiusKm: discovery.radiusKm ?? undefined,
    fromDate: discovery.fromDate || undefined,
    toDate: discovery.toDate || undefined,
    minPriceKRW: discovery.minPriceKRW ?? undefined,
    maxPriceKRW: discovery.maxPriceKRW ?? undefined,
    availableOnly: discovery.availableOnly || undefined,
  });
  const feedRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const restore = () => {
      const state = communityLocation(
        new URLSearchParams(window.location.search),
        window.location.pathname === "/stories",
      );
      setCategory(state.category ?? "all");
      setKind(state.kind === "후기" ? "이야기" : (state.kind ?? "전체"));
      setSort(state.sort ?? "latest");
      setPeriod(state.period ?? "today");
      setRankingAt(state.rankingAt ?? initialState.rankingAt);
      setView(
        state.view && state.view !== "home"
          ? state.view
          : window.location.pathname === "/stories"
            ? "stories"
            : "home",
      );
      setQuery(state.search ?? "");
      setDiscussionType(state.discussionType);
      setFocus(state.focus ?? "all");
      setTopic(state.topic ?? "");
      setTag(state.tag ?? "");
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search),
      post = params.get("post");

    // Listing parameters are initialized by the server and restored from history.
    if (post && /^[0-9a-f-]{36}$/i.test(post)) void openPost({ id: post });
    if (initialState.canWrite)
      void fetch("/api/community/me/visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => {});
  }, []);
  const active = store.detailPost?.id === activeId ? store.detailPost : null;
  const discoveryActive = hasDiscoveryFilters(discovery);
  const isHome =
    view === "home" &&
    category === "all" &&
    kind === "전체" &&
    !query &&
    !discussionType &&
    focus === "all" &&
    !topic &&
    !tag &&
    !discoveryActive;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const filtered = store.feedPosts;
  const recruitmentCards = kind === "모집" && recruitmentLayout === "card";
  const PostPreview = recruitmentCards ? CommunityRecruitmentCard : CommunityPostRow;
  function changeRecruitmentLayout(layout: RecruitmentLayout) {
    setRecruitmentLayout(layout);
    writeRecruitmentLayout(layout);
  }
  function chooseCategory(value: CategorySlug | "all") {
    setCategory(value);
    setTopic("");
    setTag("");
    setView(view === "stories" ? "stories" : "home");
    setKind(
      view === "stories"
        ? kind === "모집"
          ? "모집"
          : "이야기"
        : discovery.eventOnly
          ? "모집"
          : "전체",
    );
    setSort((current) => (current === "nearest" && discovery.coordinates ? "nearest" : "latest"));
    setQuery("");
    setSheet(null);
  }
  function resetDiscovery() {
    setDiscovery({ ...DEFAULT_DISCOVERY_FILTERS });
    setSort((current) => (current === "nearest" ? "latest" : current));
    setKind(view === "stories" ? (kind === "모집" ? "모집" : "이야기") : "전체");
  }
  function updateDiscovery(next: EventDiscoveryFilters) {
    setDiscovery(next);
    if (hasDiscoveryFilters(next)) {
      setFocus("all");
      setDiscussionType(undefined);
    }
    if (!next.coordinates && sort === "nearest") setSort("latest");
    if (!next.eventOnly)
      setKind(view === "stories" ? (kind === "모집" ? "모집" : "이야기") : "전체");
  }
  function navigate(value: View) {
    setView(value);
    setFocus("all");
    setDiscussionType(undefined);
    setDiscovery({ ...DEFAULT_DISCOVERY_FILTERS });
    setPendingNearest(false);
    setTopic("");
    setTag("");
    setCategory("all");
    setKind(value === "stories" ? "이야기" : "전체");
    setSort(value === "popular" ? "popular" : "latest");
    if (value === "popular") {
      setPeriod("today");
      setRankingAt(new Date().toISOString());
    }
    setQuery("");
  }
  async function openPost(post: { id: string }) {
    const id = post.id.toLowerCase();
    setActiveId(id);
    await store.loadPost(id);
  }
  async function savePost(id: string) {
    const wasSaved = store.bookmarked.includes(id);
    if (await store.toggleBookmark(id)) {
      setToast(wasSaved ? "북마크를 해제했어요." : "북마크에 담았어요.");
      if (!wasSaved) notifyPushOnboardingMoment("bookmark");
    }
  }

  const heading =
    view === "stories"
      ? "우리들의 이야기"
      : view === "bookmarks"
        ? "다음에 또 보고 싶은 이야기"
        : view === "mine"
          ? "나의 슬리퍼"
          : view === "popular"
            ? "지금, 가장 뜨거운 이야기"
            : category !== "all"
              ? `${label(category)}, 함께 즐겨요`
              : query
                ? `‘${query}’ 검색 결과`
                : discoveryActive
                  ? sort === "nearest"
                    ? "우리 동네, 가까운 즐거움"
                    : "내 취향에 맞는 이벤트"
                  : "오늘, 뭐 하고 놀까요?";

  return (
    <>
      <a className="skip-link" href="#main-content">
        본문으로 바로가기
      </a>
      <header className="site-header site-header--community">
        <div className="header-inner">
          <Link className="brand" href="/" aria-label="Sliper 홈" onClick={() => navigate("home")}>
            <img src="/images/sliper-logo.png" alt="" />
            <span>
              sliper<span className="brand-dot">.</span>
            </span>
          </Link>
          <span className="brand-slogan">슬쩍 나와서 리얼하게 노는 퍼블릭 모임</span>
          <SiteNavigation
            activeSection={view === "stories" ? "stories" : "home"}
            onNavigate={navigate}
          />
          <div className="header-discovery-search">
            <EventDiscoveryButton
              active={discoveryActive}
              onClick={() => {
                setPendingNearest(false);
                setDiscoveryOpen(true);
              }}
            />
            <form
              className="header-search"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                feedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <Search size={19} />
              <input
                aria-label="커뮤니티 검색"
                maxLength={100}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  if (view !== "stories") setView("home");
                }}
                placeholder={
                  view === "stories" ? "어떤 이야기가 궁금한가요?" : "어떤 즐거움을 찾고 있나요?"
                }
              />
              <Link
                className="header-unified-search-link"
                href={query.trim() ? `/search?q=${encodeURIComponent(query.trim())}` : "/search"}
                aria-label="이야기·모집·룰북·템플릿 통합 검색"
                title="룰북과 템플릿까지 함께 검색"
              >
                통합
              </Link>
              {query && (
                <button type="button" onClick={() => setQuery("")} aria-label="검색 지우기">
                  <X size={16} />
                </button>
              )}
            </form>
          </div>
          <div className="header-actions">
            <NotificationBell />
            <Link
              className="profile-button"
              href="/participation"
              aria-label="내 참가 신청과 공지방"
            >
              <MessageCircle size={20} />
            </Link>
            <Link className="profile-button" href="/mypage" aria-label="마이페이지">
              <UserRound size={20} />
            </Link>
            <TestAccountControls fallbackLogin />
          </div>
        </div>
      </header>

      <div className="page-layout page-layout--categories">
        <aside className="community-category-sidebar" aria-labelledby="community-category-heading">
          <div className="community-category-sticky">
            <h2 id="community-category-heading">카테고리</h2>
            <CategoryMenu
              category={category}
              onSelect={chooseCategory}
              className="community-category-nav"
              label="게시판 카테고리"
              showAllIcon
            />
          </div>
        </aside>
        <main id="main-content" className="main-content">
          <div className="welcome-block">
            <div className="welcome-eyebrow">
              <span className="eyebrow-line" />
              취향으로 만나는 우리 동네 예능
              <span className="preview-pill">{store.canWrite ? "로컬 개발" : "둘러보기"}</span>
            </div>
            <h1>{heading}</h1>
            <p>
              {view === "stories"
                ? "예능 이야기부터 일상의 소소한 순간까지, 편하게 나눠요."
                : view === "bookmarks"
                  ? "마음에 들었던 콘텐츠를 한곳에 모았어요."
                  : view === "mine"
                    ? "내가 남긴 이야기를 확인하세요."
                    : "취향 맞는 사람들과 만드는 우리만의 예능"}
            </p>
          </div>
          <AdSlot onCategory={chooseCategory} />
          {isHome && (
            <nav
              className="home-discover home-discover-expanded home-starts"
              aria-label="슬리퍼 시작하기"
            >
              <Link href="/?kind=모집">
                <span className="discover-icon lightning-discover-icon">
                  <Zap size={24} />
                </span>
                <div>
                  <strong>모임 찾기</strong>
                  <p>예능 이벤트부터 가벼운 번개까지</p>
                </div>
                <ChevronRight size={17} />
              </Link>
              <Link href="/stories">
                <span className="discover-icon">
                  <MessageCircle size={24} />
                </span>
                <div>
                  <strong>이야기 나누기</strong>
                  <p>같은 취향의 사람들과 나누는 대화</p>
                </div>
                <ChevronRight size={17} />
              </Link>
              <Link href="/archive">
                <span className="discover-icon">
                  <BookOpen size={24} />
                </span>
                <div>
                  <strong>기획 자료 찾기</strong>
                  <p>룰북과 템플릿으로 다음 행사 준비</p>
                </div>
                <ChevronRight size={17} />
              </Link>
            </nav>
          )}
          {category in BOARD_DESCRIPTIONS && (
            <p className="board-intro">
              {BOARD_DESCRIPTIONS[category as keyof typeof BOARD_DESCRIPTIONS]}
            </p>
          )}
          <CategoryMenu
            category={category}
            onSelect={chooseCategory}
            className="mobile-categories"
            label="빠른 카테고리"
          />

          {isHome && (
            <>
              <FeaturedCarousel
                posts={store.upcoming}
                upcoming
                onOpen={openPost}
                onSave={savePost}
                bookmarked={store.bookmarked}
                busy={store.busy}
                canWrite={store.canWrite}
                onAll={() => {
                  setKind("모집");
                  setView("home");
                }}
              />
              <HotStories posts={store.hot} onOpen={openPost} onAll={() => navigate("popular")} />
              <LatestEventRecords enabled={store.canWrite} />
            </>
          )}

          <section className="feed-section" ref={feedRef} aria-labelledby="feed-title">
            <div className="section-heading feed-heading">
              <div>
                <h2 id="feed-title">
                  {view === "stories" && category === "all" && !query
                    ? "자유게시판"
                    : view === "bookmarks"
                      ? "내 북마크"
                      : view === "mine"
                        ? "내가 쓴 글"
                        : category !== "all"
                          ? `${label(category)} 이야기`
                          : view === "popular"
                            ? "인기 이야기"
                            : query
                              ? "검색된 이야기"
                              : discoveryActive
                                ? "찾은 이벤트"
                                : "우리들의 이야기"}
                  <span className="result-count">
                    {(store.pagination?.totalItems ?? filtered.length).toLocaleString("ko-KR")}
                  </span>
                </h2>
              </div>
              <Button
                className="write-button"
                disabled={!store.canWrite || store.busy}
                onClick={() => {
                  setWriting(true);
                }}
              >
                <Pencil size={16} />
                글쓰기
              </Button>
            </div>
            {category in BOARD_TOPICS && (
              <div className="topic-filter" aria-label="세부 주제">
                <button className={!topic ? "active" : ""} onClick={() => setTopic("")}>
                  모든 주제
                </button>
                {BOARD_TOPICS[category as keyof typeof BOARD_TOPICS].map((value) => (
                  <button
                    key={value}
                    className={topic === value ? "active" : ""}
                    onClick={() => setTopic(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            )}
            {tag && (
              <button className="active-tag-filter" onClick={() => setTag("")}>
                #{tag} <X size={13} />
              </button>
            )}
            <EventDiscoveryChips
              value={discovery}
              onChange={updateDiscovery}
              onReset={resetDiscovery}
              onEdit={() => {
                setPendingNearest(false);
                setDiscoveryOpen(true);
              }}
            />
            <div className="feed-controls">
              <div className="feed-tabs" aria-label="글 유형">
                {kinds.map((value) => (
                  <button
                    key={value}
                    aria-pressed={kind === value}
                    className={cn(kind === value && "active")}
                    onClick={() => {
                      setKind(value);
                      if (value !== "이야기") {
                        setDiscussionType(undefined);
                        if (focus === "unanswered") setFocus("all");
                      }
                      if (view === "stories" && value !== "이야기" && value !== "모집")
                        setView("home");
                      if (value !== "모집" && discoveryActive) {
                        setDiscovery({ ...DEFAULT_DISCOVERY_FILTERS });
                        if (sort === "nearest") setSort("latest");
                      }
                    }}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <label className="sort-select">
                <select
                  aria-label="게시글 정렬"
                  value={sort}
                  onChange={(event) => {
                    const next = event.target.value as "latest" | "popular" | "nearest";
                    if (next === "nearest" && !discovery.coordinates) {
                      setPendingNearest(true);
                      setDiscoveryOpen(true);
                      return;
                    }
                    setSort(next);
                    if (next === "popular") setRankingAt(new Date().toISOString());
                    if (view === "popular") setView("home");
                    if (next === "nearest") {
                      setView((current) => (current === "stories" ? "stories" : "home"));
                      setDiscovery((current) => ({ ...current, eventOnly: true }));
                      setKind("모집");
                      setFocus("all");
                      setDiscussionType(undefined);
                    }
                  }}
                >
                  <option value="latest">최신순</option>
                  <option value="popular">인기순</option>
                  <option value="nearest">거리 가까운순</option>
                </select>
                <ChevronDown size={14} />
              </label>
            </div>
            {(kind === "이야기" || kind === "전체") && (
              <div className="discussion-controls">
                <div className="discussion-navigation" role="group" aria-label="이야기 탐색">
                  <button
                    aria-pressed={focus === "all" && sort === "latest"}
                    onClick={() => {
                      setFocus("all");
                      setSort("latest");
                    }}
                  >
                    최신 이야기
                  </button>
                  <button
                    aria-pressed={focus === "all" && sort === "popular"}
                    onClick={() => {
                      setFocus("all");
                      setSort("popular");
                      setRankingAt(new Date().toISOString());
                    }}
                  >
                    기간 인기
                  </button>
                  <button
                    aria-pressed={focus === "unanswered"}
                    onClick={() => {
                      setFocus("unanswered");
                      setDiscussionType("question");
                      setKind("이야기");
                      setSort("latest");
                    }}
                  >
                    답변 기다리는 질문
                  </button>
                  <button
                    aria-pressed={focus === "interests"}
                    onClick={() => {
                      setFocus("interests");
                      setSort("latest");
                    }}
                  >
                    관심 글
                  </button>
                </div>
                <div className="discussion-types" role="group" aria-label="이야기 말머리">
                  <button
                    aria-pressed={!discussionType}
                    onClick={() => {
                      setDiscussionType(undefined);
                      if (focus === "unanswered") setFocus("all");
                    }}
                  >
                    모든 이야기
                  </button>
                  {DISCUSSION_TYPES.map((value) => (
                    <button
                      key={value}
                      aria-pressed={discussionType === value}
                      onClick={() => {
                        setDiscussionType(value);
                        setKind("이야기");
                        if (value !== "question" && focus === "unanswered") setFocus("all");
                      }}
                    >
                      {DISCUSSION_LABELS[value]}
                    </button>
                  ))}
                </div>
                {focus === "interests" && (
                  <p className="interest-feed-guide">
                    {store.interestFeed === "personalized"
                      ? "구독한 카테고리와 호스트의 글을 모았어요."
                      : "아직 맞춤 관심 글이 없어 일반 글을 보여드려요."}{" "}
                    <Link
                      href={
                        store.canWrite
                          ? "/notifications#interests"
                          : "/login?returnTo=/stories%3Ffocus%3Dinterests"
                      }
                    >
                      {store.canWrite ? "관심사 설정" : "로그인하고 관심사 고르기"}
                    </Link>
                  </p>
                )}
              </div>
            )}
            {sort === "popular" && (
              <div className="popular-period" role="group" aria-label="인기 집계 기간">
                {(
                  [
                    ["today", "오늘"],
                    ["week", "이번 주"],
                    ["all", "전체"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={period === value}
                    onClick={() => {
                      setPeriod(value);
                      setRankingAt(new Date().toISOString());
                    }}
                  >
                    {label}
                  </button>
                ))}
                <button type="button" onClick={() => setRankingAt(new Date().toISOString())}>
                  지금 기준으로 새로 보기
                </button>
                <p>
                  {period === "all"
                    ? "전체 기간에 받은 좋아요 순"
                    : (period === "today" ? "한국 시간 오늘 0시" : "한국 시간 이번 주 월요일 0시") +
                      "부터 기준 시각까지 받은 좋아요 순"}
                  {period !== "all" && rankingAt
                    ? " · " +
                      new Date(rankingAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) +
                      " 기준"
                    : ""}
                </p>
              </div>
            )}
            {kind === "모집" && (
              <div className="recruitment-layout-header">
                <span>모집글 보기</span>
                <div className="recruitment-view-switch" role="group" aria-label="모집글 보기 방식">
                  <button
                    className="recruitment-view-option"
                    type="button"
                    aria-pressed={recruitmentLayout === "list"}
                    onClick={() => changeRecruitmentLayout("list")}
                  >
                    <List size={15} aria-hidden="true" />
                    목록형
                  </button>
                  <button
                    className="recruitment-view-option"
                    type="button"
                    aria-pressed={recruitmentLayout === "card"}
                    onClick={() => changeRecruitmentLayout("card")}
                  >
                    <Grid2X2 size={15} aria-hidden="true" />
                    카드형
                  </button>
                </div>
              </div>
            )}
            {store.feedError && (
              <div className="community-feed-error" role="alert">
                <p>{store.feedError}</p>
                <Button
                  variant="outline"
                  disabled={store.loading || store.busy}
                  onClick={store.retryFeed}
                >
                  다시 불러오기
                </Button>
              </div>
            )}
            {store.loading && (
              <p className="feed-status" role="status">
                이야기를 불러오는 중이에요.
              </p>
            )}
            {filtered.length ? (
              <div className={recruitmentCards ? "recruitment-card-grid" : "post-list"}>
                {filtered.map((post) => (
                  <PostPreview
                    key={post.id}
                    post={post}
                    busy={store.busy}
                    canWrite={store.canWrite}
                    onOpen={() => openPost(post)}
                    onLike={() => store.toggleLike(post.id)}
                    onSave={() => savePost(post.id)}
                    onTag={setTag}
                  />
                ))}
              </div>
            ) : store.loading || store.feedError ? null : (
              <div className="empty-state">
                <Search size={30} />
                <h3>
                  {view === "bookmarks"
                    ? "아직 담아둔 이야기가 없어요"
                    : view === "mine"
                      ? "첫 이야기를 들려주세요"
                      : "아직 일치하는 이야기가 없어요"}
                </h3>
                <p>
                  {view === "bookmarks"
                    ? "마음에 드는 글의 북마크를 눌러보세요."
                    : "다른 카테고리를 둘러보거나 새로운 이야기를 남겨보세요."}
                </p>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (view === "mine") setWriting(true);
                    else navigate("home");
                  }}
                >
                  {view === "mine" ? "첫 글 쓰기" : "전체 이야기 보기"}
                </Button>
              </div>
            )}
            {store.pagination && (
              <CommunityPagination
                pagination={store.pagination}
                disabled={store.busy || store.loading}
                onChange={(page) => {
                  store.changePage(page);
                  feedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              />
            )}
            <div className="feed-end">
              <span />
              우리의 다음 이야기는, 당신으로부터
              <span />
            </div>
          </section>
        </main>

        <aside className="right-sidebar" aria-label="커뮤니티 소식">
          <div className="play-banner">
            <div className="banner-top">
              <span>다음 주말의 계획</span>
              <Clapperboard size={27} strokeWidth={1.5} />
            </div>
            <h2>
              보는 예능에서,
              <br />
              하는 예능으로.
            </h2>
            <p>우리의 다음 에피소드를 만나보세요.</p>
            <button
              onClick={() => {
                chooseCategory("all");
                setKind("모집");
                feedRef.current?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              모집 중인 콘텐츠
              <ArrowUpRight size={18} />
            </button>
            <Link className="banner-edition" href="/archive?kind=template">
              내가 호스트가 되어볼까요? →
            </Link>
          </div>
          <div className="home-shortcuts">
            <button onClick={() => navigate("popular")}>
              <Flame size={18} />
              인기 이야기
              <ChevronRight size={15} />
            </button>
            <button onClick={() => navigate("bookmarks")}>
              <Bookmark size={18} />내 북마크
              <ChevronRight size={15} />
            </button>
            <button onClick={() => navigate("mine")}>
              <Pencil size={18} />
              내가 쓴 글<ChevronRight size={15} />
            </button>
          </div>
          <section className="trending">
            <h2>
              요즘 관심 있는 카테고리
              <Flame size={17} />
            </h2>
            {(["mind-games", "race", "party"] as const).map((slug, index) => {
              const Icon = icons[slug];
              return (
                <button key={slug} onClick={() => chooseCategory(slug)}>
                  <span className="trend-number">{index + 1}</span>
                  <Icon size={18} />
                  <span>{label(slug)}</span>
                  <ChevronRight size={15} />
                </button>
              );
            })}
          </section>
          <div className="community-note">
            <Users size={24} />
            <h3>혼자 와도, 함께 즐겨요</h3>
            <p>
              잘하는 것보다 즐기는 게 중요해요.
              <br />
              서로의 취향을 존중해주세요.
            </p>
            <button onClick={() => setSheet("guide")}>
              커뮤니티 가이드
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="preview-note">
            <span className="preview-pill">
              {store.mode === "development" ? "LOCAL" : "SLIPER"}
            </span>
            <p>
              {store.canWrite
                ? store.mode === "development"
                  ? "개발 공간이에요. 작성한 글과 반응은 로컬 DB에 저장돼요."
                  : "취향을 나누고, 함께할 다음 이벤트를 찾아보세요."
                : "로그인하면 이야기를 나누고 모임을 신청할 수 있어요."}
            </p>
          </div>
          <footer className="sidebar-footer">
            <PolicyLinks />© 2026 Sliper · 함께 만드는 즐거움
          </footer>
        </aside>
      </div>

      <div className="mobile-preview">
        {store.mode === "development"
          ? "로컬 개발 · 변경 사항은 DB에 저장"
          : "Sliper · 우리의 예능 커뮤니티"}
      </div>
      <nav className="bottom-nav" aria-label="모바일 메뉴">
        <button
          className={cn(view === "home" && !sheet && "active")}
          onClick={() => navigate("home")}
        >
          <Home size={22} />홈
        </button>
        <button onClick={() => setSheet("categories")}>
          <Grid2X2 size={22} />
          카테고리
        </button>
        <NotificationBell mobile />
        <Link href="/mypage">
          <UserRound size={22} />
          마이
        </Link>
      </nav>
      <Button
        className="mobile-write"
        aria-label="새 글 쓰기"
        disabled={!store.canWrite || store.busy}
        onClick={() => {
          setWriting(true);
        }}
      >
        <Pencil size={18} />
        글쓰기
      </Button>

      <Dialog
        open={!!activeId}
        onOpenChange={(open) => {
          if (!open) {
            setActiveId(null);
            store.closePost();
          }
        }}
      >
        <DialogContent className="post-dialog">
          {!active && (
            <div className="post-load-state" aria-busy={store.loadingPost}>
              <DialogTitle className="detail-title">
                {store.loadingPost ? "이야기를 불러오는 중" : "글을 불러오지 못했어요"}
              </DialogTitle>
              <DialogDescription className="utility-description">
                {store.loadingPost
                  ? "잠시만 기다려주세요."
                  : store.postError || "다시 시도해주세요."}
              </DialogDescription>
              {store.loadingPost ? (
                <p className="feed-status" role="status">
                  게시글을 불러오는 중이에요…
                </p>
              ) : (
                <Button
                  onClick={() => {
                    if (activeId) void store.loadPost(activeId);
                  }}
                >
                  다시 불러오기
                </Button>
              )}
            </div>
          )}
          {active && (
            <>
              <PostDetailContent
                key={active.id}
                post={active}
                store={store}
                onUnavailable={() => {
                  setActiveId(null);
                  store.closePost();
                  store.retryFeed();
                }}
              />
            </>
          )}
        </DialogContent>
      </Dialog>

      <EventDiscoveryDialog
        open={discoveryOpen}
        onOpenChange={(open) => {
          setDiscoveryOpen(open);
          if (!open) setPendingNearest(false);
        }}
        value={discovery}
        category={category}
        requireLocation={pendingNearest || sort === "nearest"}
        onApply={(next, nextCategory) => {
          setDiscovery(next);
          setCategory(nextCategory);
          setView((current) => (current === "stories" ? "stories" : "home"));
          setKind("모집");
          setTopic("");
          setTag("");
          if (pendingNearest) setSort("nearest");
          feedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />

      {writing && (
        <WriteDialog
          key="new"
          open={writing}
          onOpenChange={setWriting}
          initialCategory={category === "all" ? "party" : category}
          post={null}
          upload={store.upload}
          onPublish={async (input) => {
            const saved = await store.addPost(input);
            if (!saved) return false;
            setWriting(false);
            navigate("mine");
            setToast("새 이야기를 등록했어요.");
            return true;
          }}
        />
      )}

      <Dialog
        open={sheet !== null}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
      >
        <DialogContent className="utility-dialog">
          <DialogTitle className="utility-title">
            {sheet === "categories" ? "어떤 예능을 좋아하세요?" : "슬리퍼에 오신 걸 환영해요"}
          </DialogTitle>
          <DialogDescription className="utility-description">
            {sheet === "categories"
              ? "취향에 맞는 카테고리부터 가볍게 시작해요."
              : "각자의 취향이 모여, 우리만의 예능이 됩니다."}
          </DialogDescription>
          {sheet === "categories" && (
            <div className="category-picker">
              <button onClick={() => chooseCategory("all")}>
                <Home />
                전체
              </button>
              {CATEGORIES.map((item) => {
                const Icon = icons[item.slug];
                return (
                  <button key={item.slug} onClick={() => chooseCategory(item.slug)}>
                    <Icon />
                    {item.name}
                  </button>
                );
              })}
            </div>
          )}
          {sheet === "guide" && (
            <div className="guide-copy">
              <div>
                <span>01</span>
                <h3>취향을 따라가 보세요</h3>
                <p>여행, 레이스, 추리게임, 파티까지. 좋아하는 카테고리에서 이야기를 찾아보세요.</p>
              </div>
              <div>
                <span>02</span>
                <h3>가볍게 이야기를 나눠요</h3>
                <p>서로를 존중하며 글과 댓글을 남겨주세요. 익명이어도 배려는 잊지 않기로 해요.</p>
              </div>
              <div>
                <span>03</span>
                <h3>함께 만드는 플레이그라운드</h3>
                <p>
                  ‘예시 콘텐츠’가 표시된 행사는 둘러보기용입니다. 직접 작성한 글과 반응은 DB에
                  저장됩니다.
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {(toast || store.error) && (
        <div className="toast" role={store.error ? "alert" : "status"}>
          <Check size={18} />
          {store.error || toast}
        </div>
      )}
    </>
  );
}
