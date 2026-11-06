"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  BellRing,
  Bookmark,
  Clock3,
  Heart,
  MapPin,
  MessageCircle,
  UsersRound,
} from "lucide-react";
import type { CommunityPost } from "@/domain/community";
import type { CrewPage, CrewSummary } from "@/domain/crew";
import type { LibraryPage } from "@/domain/library";
import { CATEGORIES } from "@/domain/categories";
import { GAME_CATALOG } from "@/domain/game-catalog";
import { postPath } from "@/domain/post-sharing";
import type { Audience } from "@/lib/audience";
import { appRequest } from "@/lib/api-client";
import { shouldOpenPostModal } from "@/lib/post-sharing";
import { useReadPosts } from "@/lib/use-read-posts";
import { useSavedGames } from "@/lib/saved-games";
import { cn } from "@/lib/utils";
import { GameCover } from "./game-cover";
import { RecruitTrack } from "./home-stage";

const categoryName = (slug: string) => CATEGORIES.find((c) => c.slug === slug)?.name ?? "";

function Section({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string;
  title: string;
  description: string;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="sl-section" aria-labelledby={id}>
      <header className="sl-section__head">
        <div>
          <h2 id={id}>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="sl-section__actions">{action}</div>
      </header>
      {children}
    </section>
  );
}

function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link className="sl-text-link" href={href}>
      {children}
      <ArrowRight size={15} aria-hidden="true" />
    </Link>
  );
}

function StoriesSection({
  posts,
  onOpen,
}: {
  posts: CommunityPost[];
  onOpen: (post: CommunityPost) => void;
}) {
  const readPosts = useReadPosts();
  return (
    <Section
      id="sl-section-stories"
      title="요즘 다들 이 얘기해요"
      description="반응이 몰린 후기와 질문, 투표를 모았어요."
      action={<MoreLink href="/stories?sort=popular">이야기 더 보기</MoreLink>}
    >
      {posts.length ? (
        <div className="sl-section__grid">
          {posts.slice(0, 4).map((post, index) => (
            <a
              key={post.id}
              className="sl-story-card"
              href={postPath(post.id)}
              onClick={(event) => {
                if (!shouldOpenPostModal(event)) return;
                event.preventDefault();
                onOpen(post);
              }}
            >
              <span className="sl-story-card__rank">{index + 1}</span>
              <span className="sl-story-card__meta">
                {categoryName(post.category)} · {post.kind === "후기" ? "이야기" : post.kind}
              </span>
              <strong className={cn(readPosts.includes(post.id) && "title-is-read")}>
                {post.title}
              </strong>
              <span className="sl-story-card__excerpt">{post.excerpt}</span>
              <span className="sl-story-card__stats">
                <span>
                  <Heart size={13} aria-hidden="true" />
                  {post.popularityScore ?? post.likes}
                </span>
                <span>
                  <MessageCircle size={13} aria-hidden="true" />
                  {post.comments}
                </span>
              </span>
            </a>
          ))}
        </div>
      ) : (
        <p className="sl-section__empty">
          아직 반응이 모인 이야기가 없어요. 첫 이야기를 남겨보세요.
        </p>
      )}
    </Section>
  );
}

function RecruitSection({
  audience,
  posts,
  onOpen,
  onSave,
  bookmarked,
  busy,
  canWrite,
  onAll,
}: {
  audience: Audience;
  posts: CommunityPost[];
  onOpen: (post: CommunityPost) => void;
  onSave: (id: string) => void;
  bookmarked: string[];
  busy: boolean;
  canWrite: boolean;
  onAll: () => void;
}) {
  return (
    <Section
      id="sl-section-recruits"
      title={audience === "host" ? "다른 호스트는 이렇게 모아요" : "마감 전에 잡아야 할 모임"}
      description={
        audience === "host"
          ? "지금 모집 중인 모임의 일정·장소·참가비를 참고해보세요."
          : "날짜와 장소, 참가비를 비교하고 바로 신청하세요."
      }
      action={
        <>
          <Link className="sl-chip-link" href="/discover/saved">
            <BellRing size={14} aria-hidden="true" />
            조건 저장·모집 알림
          </Link>
          <button type="button" className="sl-text-link" onClick={onAll}>
            전체 보기
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </>
      }
    >
      {posts.length ? (
        <RecruitTrack
          posts={posts}
          onOpen={onOpen}
          onSave={onSave}
          bookmarked={bookmarked}
          busy={busy}
          canWrite={canWrite}
        />
      ) : (
        <p className="sl-section__empty">
          지금은 모집 중인 모임이 없어요. 조건을 저장해두면 새 모임이 열릴 때 알려드려요.
        </p>
      )}
    </Section>
  );
}

function GamesSection({ audience }: { audience: Audience }) {
  const [saved, toggle] = useSavedGames();
  return (
    <Section
      id="sl-section-games"
      title={audience === "host" ? "모임에 바로 꺼내 쓰는 웹게임" : "오늘 밤 한 판, 웹게임"}
      description="링크 하나로 모이고, 설치나 가입 없이 휴대폰으로 함께해요."
      action={<MoreLink href="/games">웹게임 전체</MoreLink>}
    >
      <div className="sl-section__track">
        {GAME_CATALOG.map((game) => {
          const isSaved = saved.includes(game.id);
          return (
            <div key={game.id} className="sl-game-card">
              <Link href={`/games?game=${game.id}`} className="sl-game-card__link">
                <GameCover game={game.id} />
                <span className="sl-game-card__body">
                  <span className="sl-game-card__genre">{game.genre}</span>
                  <strong>{game.title}</strong>
                  <span className="sl-game-card__hook">{game.hook}</span>
                  <span className="sl-game-card__players">
                    <UsersRound size={13} aria-hidden="true" />
                    {game.players}
                  </span>
                </span>
              </Link>
              <button
                type="button"
                className={cn("sl-game-card__save", isSaved && "is-saved")}
                aria-label={game.title + " 찜하기"}
                aria-pressed={isSaved}
                onClick={() => toggle(game.id)}
              >
                <Bookmark size={16} fill={isSaved ? "currentColor" : "none"} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function CrewsSection({ audience }: { audience: Audience }) {
  const [crews, setCrews] = useState<CrewSummary[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void appRequest<CrewPage<CrewSummary>>(
      "/api/crews?" + new URLSearchParams({ q: "", mine: "0", page: "1" }),
      "GET",
      undefined,
      controller.signal,
    )
      .then((page) => {
        if (controller.signal.aborted) return;
        // Recruiting crews first, then the most active by members and hosted events.
        const ranked = page.items
          .filter((crew) => !crew.archived)
          .sort(
            (a, b) =>
              Number(b.recruiting) - Number(a.recruiting) ||
              b.memberCount + b.eventCount - (a.memberCount + a.eventCount),
          );
        setCrews(ranked.slice(0, 6));
      })
      .catch(() => {
        if (!controller.signal.aborted) setCrews([]);
      });
    return () => controller.abort();
  }, []);
  return (
    <Section
      id="sl-section-crews"
      title={audience === "host" ? "같이 모임을 만들 크루" : "요즘 모이는 크루"}
      description={
        audience === "host"
          ? "MC·스태프·기획 파트너를 찾는 크루와 함께 모임을 키워보세요."
          : "취향이 맞는 사람들과 꾸준히 노는 팀을 찾아보세요."
      }
      action={<MoreLink href="/players?tab=crews">크루 전체</MoreLink>}
    >
      {crews === null ? (
        <p className="sl-section__empty" role="status">
          크루를 불러오고 있어요.
        </p>
      ) : crews.length ? (
        <div className="sl-section__track">
          {crews.map((crew) => (
            <Link key={crew.id} href={`/crews/${crew.id}`} className="sl-crew-card">
              <span className="sl-crew-card__avatar" aria-hidden="true">
                {crew.name.trim().slice(0, 1)}
              </span>
              <span className="sl-crew-card__top">
                <span>{categoryName(crew.category)}</span>
                {crew.recruiting && <span className="sl-crew-card__badge">멤버 모집</span>}
              </span>
              <strong>{crew.name}</strong>
              <span className="sl-crew-card__desc">{crew.description}</span>
              <span className="sl-crew-card__stats">
                <span>
                  <UsersRound size={13} aria-hidden="true" />
                  {crew.memberCount}/{crew.capacity}명
                </span>
                {crew.region && (
                  <span>
                    <MapPin size={13} aria-hidden="true" />
                    {crew.region}
                  </span>
                )}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="sl-section__empty">
          아직 공개된 크루가 없어요. <Link href="/crews/new">첫 크루 만들기</Link>
        </p>
      )}
    </Section>
  );
}

function TemplatesSection({ audience }: { audience: Audience }) {
  const [items, setItems] = useState<LibraryPage["items"] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void appRequest<LibraryPage>("/api/library?kind=template", "GET", undefined, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        // Most-run templates first: recorded events are real use, not just views.
        setItems(
          [...page.items]
            .sort(
              (a, b) =>
                b.recordedEvents - a.recordedEvents || b.recordedPlayers - a.recordedPlayers,
            )
            .slice(0, 6),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setItems([]);
      });
    return () => controller.abort();
  }, []);
  return (
    <Section
      id="sl-section-templates"
      title={audience === "host" ? "그대로 열면 되는 이벤트 템플릿" : "이렇게 노는 모임도 있어요"}
      description={
        audience === "host"
          ? "진행 순서와 준비물이 정리된 템플릿으로 기획 시간을 줄여보세요."
          : "다른 호스트들이 실제로 운영한 이벤트 템플릿이에요."
      }
      action={<MoreLink href="/archive?kind=template">템플릿 전체</MoreLink>}
    >
      {items === null ? (
        <p className="sl-section__empty" role="status">
          템플릿을 불러오고 있어요.
        </p>
      ) : items.length ? (
        <div className="sl-section__track">
          {items.map((item) => (
            <Link key={item.id} href={`/archive/${item.id}`} className="sl-template-card">
              <span className="sl-template-card__top">
                <span>{categoryName(item.category)}</span>
                <span className="sl-template-card__price">
                  {item.priceKRW ? item.priceKRW.toLocaleString("ko-KR") + "원" : "무료"}
                </span>
              </span>
              <strong>{item.title}</strong>
              <span className="sl-template-card__desc">{item.summary}</span>
              <span className="sl-template-card__stats">
                <span>
                  <UsersRound size={13} aria-hidden="true" />
                  {item.minPlayers}~{item.maxPlayers}명
                </span>
                <span>
                  <Clock3 size={13} aria-hidden="true" />
                  {item.durationMinutes}분
                </span>
                {item.recordedEvents > 0 && <span>운영 {item.recordedEvents}회</span>}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="sl-section__empty">
          아직 공개된 템플릿이 없어요. <Link href="/archive/new">첫 템플릿 올리기</Link>
        </p>
      )}
    </Section>
  );
}

/** Home sections in reading order; hosts see planning material first. */
export function HomeSections({
  audience,
  stories,
  recruitments,
  onOpen,
  onSave,
  bookmarked,
  busy,
  canWrite,
  onAllRecruits,
}: {
  audience: Audience;
  stories: CommunityPost[];
  recruitments: CommunityPost[];
  onOpen: (post: CommunityPost) => void;
  onSave: (id: string) => void;
  bookmarked: string[];
  busy: boolean;
  canWrite: boolean;
  onAllRecruits: () => void;
}) {
  const recruits = (
    <RecruitSection
      key="recruits"
      audience={audience}
      posts={recruitments}
      onOpen={onOpen}
      onSave={onSave}
      bookmarked={bookmarked}
      busy={busy}
      canWrite={canWrite}
      onAll={onAllRecruits}
    />
  );
  const sections =
    audience === "host"
      ? [
          <TemplatesSection key="templates" audience={audience} />,
          <CrewsSection key="crews" audience={audience} />,
          recruits,
          <GamesSection key="games" audience={audience} />,
          <StoriesSection key="stories" posts={stories} onOpen={onOpen} />,
        ]
      : [
          <StoriesSection key="stories" posts={stories} onOpen={onOpen} />,
          recruits,
          <GamesSection key="games" audience={audience} />,
          <CrewsSection key="crews" audience={audience} />,
          <TemplatesSection key="templates" audience={audience} />,
        ];
  return <div className="sl-sections">{sections}</div>;
}
