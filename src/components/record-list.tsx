"use client";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import {
  Award,
  BookOpenCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Crown,
  MapPin,
  MessageSquareText,
  Search,
  Star,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import { loginHref } from "@/domain/login-return";
import { CATEGORIES, type CategorySlug } from "@/domain/categories";
import {
  RECORD_MEETUP_FILTERS,
  RECORD_SORTS,
  RECORD_SORT_LABELS,
  type RecordMeetupFilter,
  type RecordPage,
  type RecordSort,
  type RecordSummary,
} from "@/domain/records";
import { appRequest } from "@/lib/api-client";
import { useAdSenseContentGuard } from "./adsense-provider";
import { ParticipationShell } from "./participation-shell";

export const recordDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(new Date(value))
    : "일정 미등록";
export const recordStatus = (status: RecordSummary["status"]) =>
  status === "published" ? "회원 공개" : status === "withdrawn" ? "공개 철회" : "기록 작성 중";

const SORT_DESCRIPTIONS: Record<RecordSort, string> = {
  popular: "별점·후기 수·참가 인원을 종합해 반응이 좋은 모임 순위로 정렬했어요.",
  rating: "참가자 평균 별점이 높은 순서대로 순위를 매겼어요.",
  reviews: "참가 후기가 많이 쌓인 모임 순서대로 정렬했어요.",
  attended: "실제 참가 인원이 많은 모임 순서대로 정렬했어요.",
  latest: "가장 최근에 완료된 모임부터 순서대로 보여드려요.",
};

const MEETUP_FILTER_LABELS: Record<RecordMeetupFilter, string> = {
  all: "전체 모임",
  event: "이벤트·행사",
  lightning: "번개·모임",
};

function SortIcon({ sort }: { sort: RecordSort }) {
  switch (sort) {
    case "popular":
      return <Trophy size={14} aria-hidden="true" />;
    case "rating":
      return <Star size={14} aria-hidden="true" />;
    case "reviews":
      return <MessageSquareText size={14} aria-hidden="true" />;
    case "attended":
      return <Users size={14} aria-hidden="true" />;
    case "latest":
      return <Clock3 size={14} aria-hidden="true" />;
  }
}

function rankTier(rank: number, sort: RecordSort): "gold" | "silver" | "bronze" | "default" {
  if (sort === "latest") return "default";
  if (rank === 1) return "gold";
  if (rank === 2) return "silver";
  if (rank === 3) return "bronze";
  return "default";
}

export function RecordCard({ item, sort = "popular" }: { item: RecordSummary; sort?: RecordSort }) {
  const categoryName = CATEGORIES.find((c) => c.slug === item.category)?.name ?? "모임";
  const tier = rankTier(item.rank, sort);
  const showRank = item.rank > 0;

  return (
    <li className="record-card">
      <Link href={"/records/" + item.postId} className="record-card__link">
        <div className="record-card__cover" data-category={item.category}>
          {item.coverImageSrc ? (
            <img src={item.coverImageSrc} alt="" loading="lazy" />
          ) : (
            <div className="record-card__cover-fallback" aria-hidden="true">
              <span className="record-card__cover-label">{categoryName}</span>
            </div>
          )}
          {showRank && (
            <span className="record-rank-badge" data-tier={tier}>
              {tier === "gold" && <Crown size={13} aria-hidden="true" />}
              {(tier === "silver" || tier === "bronze") && <Award size={13} aria-hidden="true" />}
              {sort === "latest" ? `#${item.rank}` : `${item.rank}위`}
            </span>
          )}
          <span
            className={
              item.meetupType === "lightning"
                ? "record-type-badge record-type-badge--lightning"
                : "record-type-badge"
            }
          >
            {item.meetupType === "lightning" && <Zap size={11} aria-hidden="true" />}
            {item.meetupType === "lightning" ? "번개·모임" : "이벤트·행사"}
          </span>
        </div>

        <div className="record-card__body">
          <div className="record-tags">
            <span className="record-status">{categoryName}</span>
            {item.canEdit && <span className="record-status">{recordStatus(item.status)}</span>}
          </div>
          <h3 className="record-card__title">{item.title}</h3>
          <div className="record-card__meta">
            <span>
              <CalendarDays size={13} aria-hidden="true" />
              {recordDate(item.endsAt ?? item.completedAt)}
            </span>
            {item.location && (
              <span>
                <MapPin size={13} aria-hidden="true" />
                {item.location}
              </span>
            )}
            <span>주최 {item.hostNickname}</span>
          </div>

          <div className="record-card__metrics">
            <div
              className={
                sort === "popular" || sort === "rating"
                  ? "record-metric-cell is-highlight"
                  : "record-metric-cell"
              }
            >
              <span className="record-metric-cell__value record-metric-cell__value--star">
                <Star
                  size={14}
                  fill={item.averageRating !== null ? "currentColor" : "none"}
                  aria-hidden="true"
                />
                <strong>{item.averageRating !== null ? item.averageRating.toFixed(1) : "—"}</strong>
              </span>
              <small>별점</small>
            </div>
            <div
              className={
                sort === "reviews" ? "record-metric-cell is-highlight" : "record-metric-cell"
              }
            >
              <span className="record-metric-cell__value">
                <strong>{item.reviewCount}개</strong>
              </span>
              <small>참가 후기</small>
            </div>
            <div
              className={
                sort === "attended" ? "record-metric-cell is-highlight" : "record-metric-cell"
              }
            >
              <span className="record-metric-cell__value">
                <strong>{item.attended}명</strong>
              </span>
              <small>참가 확인</small>
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}

export function RecordPagination({
  page,
  hasMore,
  busy = false,
  onChange,
}: {
  page: number;
  hasMore: boolean;
  busy?: boolean;
  onChange: (page: number) => void;
}) {
  return page > 1 || hasMore ? (
    <nav className="record-pagination" aria-label="기록 목록 페이지">
      <button
        disabled={busy || page === 1}
        onClick={() => onChange(page - 1)}
        aria-label="이전 페이지"
      >
        <ChevronLeft size={16} />
      </button>
      {page > 1 && (
        <button disabled={busy} onClick={() => onChange(page - 1)}>
          {page - 1}
        </button>
      )}
      <button aria-current="page" disabled>
        {page}
      </button>
      {hasMore && (
        <button disabled={busy} onClick={() => onChange(page + 1)}>
          {page + 1}
        </button>
      )}
      <button
        disabled={busy || !hasMore}
        onClick={() => onChange(page + 1)}
        aria-label="다음 페이지"
      >
        <ChevronRight size={16} />
      </button>
    </nav>
  ) : null;
}

export function RecordsLogin({
  returnTo = "/archive?tab=records",
  embedded = false,
}: {
  returnTo?: string;
  embedded?: boolean;
}) {
  useAdSenseContentGuard(true);
  const Shell = embedded ? Fragment : ParticipationShell;
  const Heading = embedded ? "h2" : "h1";
  return (
    <Shell>
      <section className="record-page record-empty workspace-record-login">
        <BookOpenCheck size={30} />
        <Heading>함께 만든 경험이 기록과 랭킹으로 남아요</Heading>
        <p>로그인하면 완료한 이벤트·번개 모임의 별점 랭킹과 참가 후기를 볼 수 있어요.</p>
        <Link className="participation-primary" href={loginHref(returnTo)}>
          로그인하고 기록 보기
        </Link>
      </section>
    </Shell>
  );
}

export function RecordsList({
  libraryId,
  embedded = false,
}: { libraryId?: string; embedded?: boolean } = {}) {
  useAdSenseContentGuard(true);
  const Shell = embedded ? Fragment : ParticipationShell;
  const [data, setData] = useState<RecordPage | null>(null),
    [q, setQ] = useState(""),
    [category, setCategory] = useState<CategorySlug | "">(""),
    [mine, setMine] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const sequence = useRef(0);
  const [filters, setFilters] = useState<{
    q: string;
    category: CategorySlug | "";
    meetupType: RecordMeetupFilter;
    sort: RecordSort;
    mine: boolean;
    page: number;
  }>({
    q: "",
    category: "",
    meetupType: "all",
    sort: "popular",
    mine: false,
    page: 1,
  });

  useEffect(() => {
    const controller = new AbortController(),
      token = ++sequence.current;
    const params = new URLSearchParams({
      q: filters.q,
      mine: filters.mine ? "1" : "0",
      sort: filters.sort,
      meetupType: filters.meetupType,
      page: String(filters.page),
    });
    if (libraryId) params.set("libraryId", libraryId);
    if (filters.category) params.set("category", filters.category);
    setBusy(true);
    setError("");
    appRequest<RecordPage>("/api/records?" + params, "GET", undefined, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted && token === sequence.current) setData(next);
      })
      .catch((cause) => {
        if (!controller.signal.aborted && token === sequence.current) {
          setData(null);
          setError(cause instanceof Error ? cause.message : "기록을 불러오지 못했어요.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && token === sequence.current) setBusy(false);
      });
    return () => controller.abort();
  }, [filters, libraryId]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setFilters((before) => ({ ...before, q: q.trim(), category, mine, page: 1 }));
  }

  return (
    <Shell>
      <div className="record-page">
        {!embedded ? (
          <header className="record-heading">
            <div>
              <span className="record-kicker">SLIPER EVENT RANKING & RECORDS</span>
              <h1>즐거움은 끝나도, 별점과 기록은 남아요</h1>
              <p>완료된 이벤트·번개 모임의 랭킹과 참가자들의 생생한 후기를 한눈에 비교해보세요.</p>
            </div>
            <Link className="participation-secondary" href="/mypage?tab=events&view=hosting">
              내 행사 기록하기
            </Link>
          </header>
        ) : (
          <div className="record-heading">
            <div>
              <span className="record-kicker">EVENT RANKING & RECORDS</span>
              <p>완료된 이벤트·번개 모임의 순위와 참가자 별점·후기를 카드로 둘러보세요.</p>
            </div>
            <Link className="participation-secondary" href="/mypage?tab=events&view=hosting">
              내 행사 기록하기
            </Link>
          </div>
        )}
        {libraryId && (
          <p className="record-note">
            선택한 자료와 연결된 행사 기록이에요.{" "}
            <Link href="/archive?tab=records">모든 기록 보기 →</Link>
          </p>
        )}

        <div className="record-ranking-controls">
          <div className="record-sort-bar" role="tablist" aria-label="행사 기록 랭킹 정렬 기준">
            {RECORD_SORTS.map((sortOption) => {
              const active = filters.sort === sortOption;
              return (
                <button
                  key={sortOption}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={active ? "record-sort-pill is-active" : "record-sort-pill"}
                  disabled={busy}
                  onClick={() => setFilters((before) => ({ ...before, sort: sortOption, page: 1 }))}
                >
                  <SortIcon sort={sortOption} />
                  {RECORD_SORT_LABELS[sortOption]}
                </button>
              );
            })}
          </div>
          <div className="record-meetup-bar" role="group" aria-label="모임 유형 필터">
            {RECORD_MEETUP_FILTERS.map((typeOption) => {
              const active = filters.meetupType === typeOption;
              return (
                <button
                  key={typeOption}
                  type="button"
                  aria-pressed={active}
                  className={active ? "record-meetup-pill is-active" : "record-meetup-pill"}
                  disabled={busy}
                  onClick={() =>
                    setFilters((before) => ({ ...before, meetupType: typeOption, page: 1 }))
                  }
                >
                  {MEETUP_FILTER_LABELS[typeOption]}
                </button>
              );
            })}
          </div>
        </div>

        <form className="record-filters" onSubmit={submit}>
          <label>
            찾고 싶은 행사
            <input
              type="search"
              maxLength={100}
              placeholder="행사 이름으로 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <label>
            활동 분야
            <select
              value={category}
              onChange={(e) => {
                const next = e.target.value as CategorySlug | "";
                setCategory(next);
                setFilters((before) => ({ ...before, category: next, page: 1 }));
              }}
            >
              <option value="">모든 분야</option>
              {CATEGORIES.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            보기
            <select
              value={mine ? "mine" : "all"}
              onChange={(e) => {
                const nextMine = e.target.value === "mine";
                setMine(nextMine);
                setFilters((before) => ({ ...before, mine: nextMine, page: 1 }));
              }}
            >
              <option value="all">공개된 행사 기록</option>
              <option value="mine">내 행사와 작성 중인 기록</option>
            </select>
          </label>
          <button className="participation-primary" disabled={busy}>
            <Search size={15} />
            찾기
          </button>
        </form>

        {error && (
          <p className="participation-error" role="alert">
            {error}
          </p>
        )}
        {busy && !data && (
          <p className="record-note" role="status">
            행사 기록 랭킹을 불러오고 있어요.
          </p>
        )}
        {data && (
          <>
            <div className="record-ranking-summary">
              <p className="record-results-count">
                <strong>{RECORD_SORT_LABELS[data.sort]}</strong> · 총{" "}
                {data.total.toLocaleString("ko-KR")}개 행사
              </p>
              <span className="record-ranking-caption">{SORT_DESCRIPTIONS[data.sort]}</span>
            </div>
            {data.items.length > 0 ? (
              <ul className="record-card-grid">
                {data.items.map((item) => (
                  <RecordCard key={item.postId} item={item} sort={data.sort} />
                ))}
              </ul>
            ) : (
              <section className="record-empty">
                <BookOpenCheck size={30} />
                <h2>다음 즐거움의 첫 기록을 기다려요</h2>
                <p>
                  {filters.mine
                    ? "담당하는 행사를 완료 확인하면 기록 초안이 만들어져요."
                    : "아직 이 조건에 맞는 공개 기록이 없어요."}
                </p>
                <Link href="/mypage?tab=events&view=hosting" className="participation-secondary">
                  내 행사 확인
                </Link>
              </section>
            )}
            <RecordPagination
              page={data.page}
              hasMore={data.hasMore}
              busy={busy}
              onChange={(page) => setFilters((before) => ({ ...before, page }))}
            />
          </>
        )}
      </div>
    </Shell>
  );
}
