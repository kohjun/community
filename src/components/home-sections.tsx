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
  Thermometer,
  UsersRound,
} from "lucide-react";
import type { CommunityPost } from "@/domain/community";
import type { CrewPage, CrewSummary } from "@/domain/crew";
import type { LibraryPage } from "@/domain/library";
import { loginHref } from "@/domain/login-return";
import { PLAYER_ROLE_LABELS, type PlayerCard, type PlayerDirectoryView } from "@/domain/player";
import { CATEGORIES } from "@/domain/categories";
import { GAME_CATALOG } from "@/domain/game-catalog";
import {
  EVENT_RECRUITMENTS_HREF,
  MEETUP_TYPE_LABELS,
  type MeetupType,
} from "@/domain/meetup-types";
import { postPath } from "@/domain/post-sharing";
import type { Audience } from "@/lib/audience";
import { appRequest } from "@/lib/api-client";
import { shouldOpenPostModal } from "@/lib/post-sharing";
import { useReadPosts } from "@/lib/use-read-posts";
import { useSavedGames } from "@/lib/saved-games";
import { cn } from "@/lib/utils";
import { GameCover } from "./game-cover";
import { RecruitTrack } from "./home-stage";
import { ExampleGallery } from "./example-gallery";

const HOME_SECTION_LIMIT = 8;
const categoryName = (slug: string) => CATEGORIES.find((c) => c.slug === slug)?.name ?? "";

function Section({
  id,
  title,
  description,
  action,
  tinted = false,
  children,
}: {
  id: string;
  title: string;
  description: string;
  action: ReactNode;
  tinted?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={cn("sl-section-band", tinted && "sl-section-band--tinted")}
      aria-labelledby={id}
    >
      <div className="sl-section">
        <header className="sl-section__head">
          <div>
            <h2 id={id}>{title}</h2>
            <p>{description}</p>
          </div>
          <div className="sl-section__actions">{action}</div>
        </header>
        {children}
      </div>
    </section>
  );
}

function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link className="sl-pill-link" href={href}>
      {children}
      <ArrowRight size={14} aria-hidden="true" />
    </Link>
  );
}

function StoriesSection({
  posts,
  onOpen,
  tinted = false,
}: {
  posts: CommunityPost[];
  onOpen: (post: CommunityPost) => void;
  tinted?: boolean;
}) {
  const readPosts = useReadPosts();
  return (
    <Section
      id="sl-section-stories"
      title="지금 인기 있는 이야기"
      description="반응이 모인 모임 후기와 예능 이야기를 한눈에 살펴보세요."
      tinted={tinted}
      action={<MoreLink href="/stories?sort=popular">이야기 전체 보기</MoreLink>}
    >
      {posts.length ? (
        <div className="sl-section__grid">
          {posts.slice(0, HOME_SECTION_LIMIT).map((post, index) => (
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
  type,
  posts,
  onOpen,
  onSave,
  bookmarked,
  busy,
  canWrite,
  tinted = false,
}: {
  type: MeetupType;
  posts: CommunityPost[];
  onOpen: (post: CommunityPost) => void;
  onSave: (id: string) => void;
  bookmarked: string[];
  busy: boolean;
  canWrite: boolean;
  tinted?: boolean;
}) {
  const isEvent = type === "event";
  const label = MEETUP_TYPE_LABELS[type];
  const openPosts = posts.filter((post) => !post.sample);
  return (
    <Section
      id={`sl-section-recruits-${type}`}
      title={isEvent ? "예능 한 판, 주인공은 우리" : "슬쩍 나올 사람?"}
      description={
        isEvent
          ? "미션 레이스, 추리 게임, 예능 파티 등 예정된 행사를 살펴보세요."
          : "번개·모임 · 시간과 취향이 맞는 사람들과 가볍게 만나요."
      }
      tinted={tinted}
      action={
        <>
          {isEvent && (
            <Link className="sl-chip-link" href="/discover/saved">
              <BellRing size={14} aria-hidden="true" />
              조건 저장·모집 알림
            </Link>
          )}
          <MoreLink href={isEvent ? EVENT_RECRUITMENTS_HREF : "/lightning"}>
            {label} 전체 보기
          </MoreLink>
        </>
      }
    >
      {openPosts.length ? (
        <RecruitTrack
          posts={openPosts.slice(0, HOME_SECTION_LIMIT)}
          onOpen={onOpen}
          onSave={onSave}
          bookmarked={bookmarked}
          busy={busy}
          canWrite={canWrite}
        />
      ) : (
        <ExampleGallery kind={type} compact={!isEvent} />
      )}
    </Section>
  );
}

function GamesSection({ audience, tinted = false }: { audience: Audience; tinted?: boolean }) {
  const [saved, toggle] = useSavedGames();
  return (
    <Section
      id="sl-section-games"
      title={audience === "host" ? "모임에 바로 쓰는 웹게임" : "웹게임"}
      description="링크 하나로 모이고, 설치나 가입 없이 휴대폰으로 바로 함께해요."
      tinted={tinted}
      action={<MoreLink href="/games">웹게임 전체 보기</MoreLink>}
    >
      <div className="sl-section__grid">
        {GAME_CATALOG.slice(0, HOME_SECTION_LIMIT).map((game) => {
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

/** Host home: partner crews for staffing and co-hosting. */
function CrewsSection({ tinted = false }: { tinted?: boolean }) {
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
        setCrews(ranked.slice(0, HOME_SECTION_LIMIT));
      })
      .catch(() => {
        if (!controller.signal.aborted) setCrews([]);
      });
    return () => controller.abort();
  }, []);
  return (
    <Section
      id="sl-section-crews"
      title="같이 모임을 만들 크루"
      description="MC·스태프·기획 파트너를 찾는 크루와 함께 모임을 키워보세요."
      tinted={tinted}
      action={<MoreLink href="/players?tab=crews">크루 전체 보기</MoreLink>}
    >
      {crews === null ? (
        <p className="sl-section__empty" role="status">
          크루를 불러오고 있어요.
        </p>
      ) : crews.length ? (
        <div className="sl-section__grid">
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

function PlayersSection({ signedIn, tinted = false }: { signedIn: boolean; tinted?: boolean }) {
  const [players, setPlayers] = useState<PlayerCard[] | null>(null);
  useEffect(() => {
    // The directory is members-only, so visitors get a sign-in prompt instead of a request.
    if (!signedIn) return;
    const controller = new AbortController();
    void appRequest<PlayerDirectoryView>("/api/players", "GET", undefined, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        // Players with a set role and verified attendance first: easier to judge at a glance.
        const ranked = [...page.items].sort(
          (a, b) =>
            Number(!!b.preferredRole) - Number(!!a.preferredRole) ||
            (b.careerVisible ? b.summary.attended : 0) - (a.careerVisible ? a.summary.attended : 0),
        );
        setPlayers(ranked.slice(0, HOME_SECTION_LIMIT));
      })
      .catch(() => {
        if (!controller.signal.aborted) setPlayers([]);
      });
    return () => controller.abort();
  }, [signedIn]);
  return (
    <Section
      id="sl-section-players"
      title="같이 놀 플레이어 찾기"
      description="역할 성향과 매너 온도를 보고 나와 잘 맞는 플레이어를 찾아보세요."
      tinted={tinted}
      action={<MoreLink href="/players">플레이어 전체 보기</MoreLink>}
    >
      {!signedIn ? (
        <>
          <ExampleGallery kind="player" />
          <div className="sl-player-card__login">
            <strong>로그인하고 플레이어를 만나보세요</strong>
            <span>플레이어의 성향과 공개한 참가 경험을 확인할 수 있어요.</span>
            <Link className="sl-chip-link" href={loginHref("/players")}>
              로그인하기
            </Link>
          </div>
        </>
      ) : players === null ? (
        <p className="sl-section__empty" role="status">
          플레이어를 불러오고 있어요.
        </p>
      ) : players.length ? (
        <div className="sl-section__grid">
          {players.map((player) => (
            <Link
              key={player.publicId}
              href={`/players/${player.publicId}`}
              className="sl-crew-card sl-player-card"
            >
              <span className="sl-crew-card__avatar" aria-hidden="true">
                {player.nickname.trim().slice(0, 1)}
              </span>
              <span className="sl-crew-card__top">
                <span>
                  {player.preferredRole ? PLAYER_ROLE_LABELS[player.preferredRole] : "성향 탐색 중"}
                </span>
              </span>
              <strong>{player.nickname}</strong>
              <span className="sl-crew-card__desc">{player.bio || "다음 게임에서 만나요."}</span>
              <span className="sl-crew-card__stats">
                <span>
                  <Thermometer size={13} aria-hidden="true" />
                  {player.summary.mannerTemperature.toFixed(1)}℃
                </span>
                {player.careerVisible && <span>참가 {player.summary.attended}회</span>}
                {player.region && (
                  <span>
                    <MapPin size={13} aria-hidden="true" />
                    {player.region}
                  </span>
                )}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <ExampleGallery kind="player" />
      )}
    </Section>
  );
}

/** Host home: ready-to-run event templates. */
function TemplatesSection({ tinted = false }: { tinted?: boolean }) {
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
            .slice(0, HOME_SECTION_LIMIT),
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
      title="그대로 열면 되는 이벤트 템플릿"
      description="진행 순서와 준비물이 정리된 템플릿으로 기획 시간을 줄여보세요."
      tinted={tinted}
      action={<MoreLink href="/archive?kind=template">템플릿 전체 보기</MoreLink>}
    >
      {items === null ? (
        <p className="sl-section__empty" role="status">
          템플릿을 불러오고 있어요.
        </p>
      ) : items.length ? (
        <div className="sl-section__grid">
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

/**
 * Home sections in reading order. Participants find something to join and people to play with;
 * hosts get planning material (templates, partner crews) and no recruitment browsing.
 */
export function HomeSections({
  audience,
  stories,
  recruitments,
  onOpen,
  onSave,
  bookmarked,
  busy,
  canWrite,
}: {
  audience: Audience;
  stories: CommunityPost[];
  recruitments: Record<MeetupType, CommunityPost[]>;
  onOpen: (post: CommunityPost) => void;
  onSave: (id: string) => void;
  bookmarked: string[];
  busy: boolean;
  canWrite: boolean;
}) {
  const sections =
    audience === "host"
      ? [
          <TemplatesSection key="templates" />,
          <CrewsSection key="crews" tinted />,
          <GamesSection key="games" audience={audience} />,
          <StoriesSection key="stories" posts={stories} onOpen={onOpen} tinted />,
        ]
      : [
          ...(["event", "lightning"] as const).map((type) => (
            <RecruitSection
              key={type}
              type={type}
              posts={recruitments[type]}
              onOpen={onOpen}
              onSave={onSave}
              bookmarked={bookmarked}
              busy={busy}
              canWrite={canWrite}
              tinted={type === "lightning"}
            />
          )),
          <StoriesSection key="stories" posts={stories} onOpen={onOpen} />,
          <GamesSection key="games" audience={audience} />,
          <PlayersSection key="players" signedIn={canWrite} tinted />,
        ];
  return <div className="sl-sections">{sections}</div>;
}
