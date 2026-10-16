"use client";
import { useAdSenseContentGuard } from "./adsense-provider";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  BookOpen,
  Clock3,
  Plus,
  Search,
  Users,
  ArrowUpRight,
  SlidersHorizontal,
} from "lucide-react";
import { ParticipationShell } from "./participation-shell";
import { appRequest } from "@/lib/api-client";
import { CATEGORIES } from "@/domain/categories";
import type { LibraryKind, LibraryPage } from "@/domain/library";
import {
  emptyLibraryFilters,
  libraryCursorFromParams,
  libraryFilterParams,
  libraryFiltersFromParams,
  libraryFilterUrl,
  type LibraryFilterState,
} from "./library-discovery-query";
import styles from "./library-discovery.module.css";
import {
  LibraryDiscoveryConditions,
  LIBRARY_DIFFICULTY_LABELS,
  LIBRARY_ENVIRONMENT_LABELS,
} from "./library-discovery-metadata";

const LIBRARY_FILTERS: { value: LibraryKind | ""; label: string }[] = [
  { value: "", label: "전체" },
  { value: "rulebook", label: "룰북" },
  { value: "template", label: "이벤트 템플릿" },
];

export function LibraryList({
  initial,
  initialKind,
  initialQuery,
  initialError = "",
}: {
  initial: LibraryPage;
  initialKind?: LibraryKind;
  initialQuery?: LibraryFilterState;
  initialError?: string;
}) {
  const [data, setData] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(initialError),
    [query, setQuery] = useState(initialQuery ?? emptyLibraryFilters(initialKind)),
    [appliedQuery, setAppliedQuery] = useState(query),
    activeRequest = useRef<AbortController | null>(null);

  const advertisingBlocked =
    query.mine || query.used || appliedQuery.mine || appliedQuery.used || data.items.length === 0;
  useAdSenseContentGuard(advertisingBlocked);
  const load = useCallback(
    async (
      value: LibraryFilterState,
      options: { cursor?: string; append?: boolean; updateUrl?: boolean } = {},
    ) => {
      activeRequest.current?.abort();
      const controller = new AbortController();
      activeRequest.current = controller;
      setBusy(true);
      setError("");
      try {
        const params = libraryFilterParams(value, options.cursor);
        const page = await appRequest<LibraryPage>(
          `/api/library?${params}`,
          "GET",
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setData((previous) =>
          options.append ? { ...page, items: [...previous.items, ...page.items] } : page,
        );
        if (!options.append) {
          setQuery(value);
          setAppliedQuery(value);
        }
        if (options.updateUrl !== false) {
          const url = libraryFilterUrl(new URL(window.location.href), value, options.cursor);
          window.history.replaceState(window.history.state, "", url);
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : "자료를 불러오지 못했어요.");
      } finally {
        if (activeRequest.current === controller) setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      const cursor = libraryCursorFromParams(params);
      void load(libraryFiltersFromParams(params), {
        ...(cursor ? { cursor } : {}),
        updateUrl: false,
      });
    };
    window.addEventListener("popstate", restore);
    return () => {
      activeRequest.current?.abort();
      window.removeEventListener("popstate", restore);
    };
  }, [load]);

  function search(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void load(query);
  }

  const appliedLabels = [
    appliedQuery.players && `${appliedQuery.players}명 참여 가능`,
    appliedQuery.maxDurationMinutes && `${appliedQuery.maxDurationMinutes}분 이내`,
    appliedQuery.price && (appliedQuery.price === "free" ? "무료 자료" : "유료 자료"),
    appliedQuery.used && "회원 공개 운영 사례 있음",
    appliedQuery.difficulty && `준비 ${LIBRARY_DIFFICULTY_LABELS[appliedQuery.difficulty]}`,
    appliedQuery.environment && LIBRARY_ENVIRONMENT_LABELS[appliedQuery.environment],
    appliedQuery.maxStaff && `추가 스태프 ${appliedQuery.maxStaff}명 이하`,
  ].filter(Boolean);

  return (
    <ParticipationShell advertising={!advertisingBlocked}>
      <section className="marketplace-hero">
        <div>
          <span className="marketplace-kicker">SLIPER PLAY ARCHIVE</span>
          <h1>아카이브</h1>
          <p>
            함께 놀 방법을 한곳에. 게임의 규칙과 진행 가이드를 찾고, 완성된 이벤트 템플릿으로 다음
            모임을 열어보세요.
          </p>
        </div>
        {data.canWrite && (
          <Link
            href={query.kind === "template" ? "/archive/new?kind=template" : "/archive/new"}
            className="participation-primary"
          >
            <Plus size={17} />
            자료 올리기
          </Link>
        )}
      </section>
      <div className="marketplace-actions">
        <Link href="/topics" className="participation-secondary">
          취향별 이야기·모임·자료 둘러보기
        </Link>
      </div>
      {data.canWrite && (
        <nav className="marketplace-actions" aria-label="아카이브 거래 관리">
          <Link href="/archive/purchases" className="participation-secondary">
            내 구매
          </Link>
          <Link href="/archive/purchases?scope=selling" className="participation-secondary">
            판매 관리
          </Link>
        </nav>
      )}
      <div className="marketplace-tabs archive-kind-filters" aria-label="자료 유형">
        {LIBRARY_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            disabled={busy}
            aria-pressed={appliedQuery.kind === filter.value}
            onClick={() => void load({ ...query, kind: filter.value })}
          >
            {filter.label}
          </button>
        ))}
      </div>
      <form className={styles.filterPanel} onSubmit={search} aria-label="아카이브 검색 조건">
        <div className={styles.searchRow}>
          <label className={styles.searchField}>
            <Search size={17} aria-hidden="true" />
            <input
              name="search"
              type="search"
              maxLength={100}
              placeholder="게임 이름이나 진행 방식을 찾아보세요"
              value={query.search}
              onChange={(e) => setQuery((previous) => ({ ...previous, search: e.target.value }))}
              disabled={busy}
              aria-label="자료 검색"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.visuallyHidden}>주제 선택</span>
            <select
              name="category"
              value={query.category}
              onChange={(e) => setQuery((previous) => ({ ...previous, category: e.target.value }))}
              disabled={busy}
              aria-label="주제 선택"
            >
              <option value="">모든 주제</option>
              {CATEGORIES.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.filterGrid}>
          <label className={styles.field}>
            참가 인원
            <input
              name="players"
              type="number"
              min={1}
              max={5000}
              step={1}
              placeholder="예: 12명"
              value={query.players}
              onChange={(e) => setQuery((previous) => ({ ...previous, players: e.target.value }))}
              disabled={busy}
            />
          </label>
          <label className={styles.field}>
            최대 진행 시간 (분)
            <input
              name="maxDurationMinutes"
              type="number"
              min={5}
              max={1440}
              step={1}
              placeholder="예: 120분"
              value={query.maxDurationMinutes}
              onChange={(e) =>
                setQuery((previous) => ({ ...previous, maxDurationMinutes: e.target.value }))
              }
              disabled={busy}
            />
          </label>
          <label className={styles.field}>
            자료 가격
            <select
              name="price"
              value={query.price}
              onChange={(e) =>
                setQuery((previous) => ({
                  ...previous,
                  price: e.target.value as LibraryFilterState["price"],
                }))
              }
              disabled={busy}
            >
              <option value="">무료·유료 전체</option>
              <option value="free">무료 자료</option>
              <option value="paid">유료 자료</option>
            </select>
          </label>
          <label className={styles.field}>
            운영 사례
            <select
              name="used"
              value={query.used ? "true" : ""}
              onChange={(e) =>
                setQuery((previous) => ({ ...previous, used: e.target.value === "true" }))
              }
              disabled={busy || !data.canWrite}
            >
              <option value="">모든 자료</option>
              <option value="true">회원 공개 운영 사례 있음</option>
            </select>
          </label>
        </div>
        {!data.canWrite && (
          <p className={styles.hint}>
            회원 공개 운영 사례로 찾으려면{" "}
            <Link
              href={
                "/login?returnTo=" +
                encodeURIComponent("/archive?" + libraryFilterParams({ ...query, used: true }))
              }
            >
              로그인
            </Link>
            해주세요.
          </p>
        )}
        <details className={styles.advanced}>
          <summary>
            <SlidersHorizontal size={15} aria-hidden="true" /> 운영 조건 더 보기
          </summary>
          <div className={styles.advancedGrid}>
            <label className={styles.field}>
              준비 난이도
              <select
                name="difficulty"
                value={query.difficulty}
                onChange={(e) =>
                  setQuery((previous) => ({
                    ...previous,
                    difficulty: e.target.value as LibraryFilterState["difficulty"],
                  }))
                }
                disabled={busy}
              >
                <option value="">모든 난이도</option>
                <option value="easy">쉬움</option>
                <option value="standard">보통</option>
                <option value="advanced">높음</option>
              </select>
            </label>
            <label className={styles.field}>
              진행 환경
              <select
                name="environment"
                value={query.environment}
                onChange={(e) =>
                  setQuery((previous) => ({
                    ...previous,
                    environment: e.target.value as LibraryFilterState["environment"],
                  }))
                }
                disabled={busy}
              >
                <option value="">모든 환경</option>
                <option value="indoor">실내</option>
                <option value="outdoor">실외</option>
                <option value="mixed">실내·외 혼합</option>
              </select>
            </label>
            <label className={styles.field}>
              추가 스태프 최대 인원
              <input
                name="maxStaff"
                type="number"
                min={0}
                max={100}
                step={1}
                placeholder="예: 2명"
                value={query.maxStaff}
                onChange={(e) =>
                  setQuery((previous) => ({ ...previous, maxStaff: e.target.value }))
                }
                disabled={busy}
              />
            </label>
          </div>
          <p className={styles.hint}>
            작성자가 공개한 운영 조건으로 찾아요. 미입력 자료는 해당 조건 검색에서 제외돼요.
          </p>
        </details>
        <div className={styles.filterFooter}>
          {data.canWrite && (
            <button
              type="button"
              className={styles.mineToggle}
              role="switch"
              aria-checked={query.mine}
              onClick={() => setQuery((previous) => ({ ...previous, mine: !previous.mine }))}
              disabled={busy}
            >
              <span aria-hidden="true" /> 내 자료·초안
            </button>
          )}
          <div className={styles.filterButtons}>
            <button
              type="button"
              className="participation-secondary"
              onClick={() => void load(emptyLibraryFilters(query.kind))}
              disabled={busy}
            >
              조건 초기화
            </button>
            <button className="participation-primary" disabled={busy}>
              {busy ? "불러오는 중…" : "자료 찾기"}
            </button>
          </div>
        </div>
      </form>
      {error && (
        <p className="marketplace-alert" role="alert">
          {error}
        </p>
      )}
      {appliedLabels.length > 0 && (
        <div className={styles.appliedFilters} aria-label="적용된 검색 조건">
          {appliedLabels.map((label) => (
            <span key={String(label)}>{label}</span>
          ))}
        </div>
      )}
      {appliedQuery.mine && (
        <p className="library-save-message">
          내 발행 자료와 작성 중인 비공개 초안을 함께 보여드려요.
        </p>
      )}
      <div className="marketplace-grid" aria-busy={busy}>
        {data.items.map((entry) => (
          <Link key={entry.id} className="marketplace-card" href={`/archive/${entry.id}`}>
            <div className="marketplace-card-top">
              <div className="archive-card-labels">
                <span className="archive-kind-badge">
                  {entry.kind === "template" ? "이벤트 템플릿" : "룰북"}
                </span>
                <span>{CATEGORIES.find((c) => c.slug === entry.category)?.name}</span>
              </div>
              {entry.status === "draft" ? (
                <span className="archive-kind-badge">초안</span>
              ) : (
                <ArrowUpRight size={17} />
              )}
            </div>
            <h2>{entry.title}</h2>
            {entry.status === "draft" && (
              <small className="library-draft-note">나만 볼 수 있는 미발행 자료</small>
            )}
            <p>{entry.summary}</p>
            <div className="marketplace-meta">
              <span>
                <Users size={14} /> {entry.minPlayers}–{entry.maxPlayers}명
              </span>
              <span>
                <Clock3 size={14} /> {entry.durationMinutes}분
              </span>
            </div>
            <LibraryDiscoveryConditions metadata={entry.discoveryMetadata ?? null} />
            <div className="marketplace-tags">
              {entry.tags.map((tag) => (
                <span key={tag}>#{tag}</span>
              ))}
            </div>
            <div className="marketplace-card-bottom">
              <span>{entry.author}</span>
              <strong className="marketplace-price">
                {entry.priceKRW ? `${entry.priceKRW.toLocaleString()}원` : "무료"}
              </strong>
            </div>
            {data.canWrite && (
              <small className={styles.visibleCases}>
                회원 공개 운영 사례 {entry.visibleUseCases ?? 0}개
              </small>
            )}
            <small>
              {entry.recordedEvents
                ? `실제 운영 사례 ${entry.recordedEvents}회 · 참가 연인원 ${entry.recordedPlayers}명`
                : "커뮤니티 공유 자료 · 실제 운영 사례 없음"}
            </small>
          </Link>
        ))}
      </div>
      {!data.items.length && (
        <section className="participation-card participation-empty">
          <BookOpen size={32} />
          <h2>조건을 조금 넓혀서 찾아보세요</h2>
          <p>
            {appliedQuery.mine
              ? "조건에 맞는 내 자료와 초안이 없어요."
              : "아직 조건에 맞는 자료가 없어요."}
          </p>
          <button
            type="button"
            className="participation-secondary"
            disabled={busy}
            onClick={() => void load(emptyLibraryFilters(query.kind))}
          >
            조건 초기화
          </button>
        </section>
      )}
      {data.nextCursor && (
        <button
          className="participation-secondary"
          disabled={busy}
          onClick={() => void load(appliedQuery, { cursor: data.nextCursor!, append: true })}
        >
          자료 더 보기
        </button>
      )}
      <p className="marketplace-disclaimer">
        실제 운영 사례는 완료가 확인된 행사에서 이 자료를 사용한 기록이에요. 참가 연인원은 행사별
        참가 인원을 합산하며, 전문 심사나 게임 품질 인증을 의미하지 않아요.
      </p>
    </ParticipationShell>
  );
}
