"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Handshake, MapPin, Plus, Search, Users } from "lucide-react";
import { ParticipationShell } from "./participation-shell";
import { appRequest } from "@/lib/api-client";
import { CATEGORIES } from "@/domain/categories";
import type { CrewPage, CrewSummary } from "@/domain/crew";
export interface CrewFilters {
  q: string;
  category: string;
  mine: boolean;
}
const DEFAULT_CREW_FILTERS: CrewFilters = { q: "", category: "", mine: false };

export function CrewDirectory({
  initial,
  canWrite,
  initialQuery = DEFAULT_CREW_FILTERS,
  embedded = false,
}: {
  initial: CrewPage<CrewSummary>;
  canWrite: boolean;
  initialQuery?: CrewFilters;
  embedded?: boolean;
}) {
  const [data, setData] = useState(initial),
    [query, setQuery] = useState(initialQuery),
    [draft, setDraft] = useState(initialQuery),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const version = useRef(0),
    pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      version.current++;
      pending.current?.abort();
    },
    [],
  );
  useEffect(() => {
    version.current++;
    pending.current?.abort();
    setData(initial);
    setQuery(initialQuery);
    setDraft(initialQuery);
    setBusy(false);
    setError("");
  }, [initial, initialQuery]);
  async function load(filters: CrewFilters, page = 1) {
    const token = ++version.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({
        q: filters.q,
        mine: filters.mine ? "1" : "0",
        page: String(page),
      });
      if (filters.category) params.set("category", filters.category);
      const next = await appRequest<CrewPage<CrewSummary>>(
        "/api/crews?" + params,
        "GET",
        undefined,
        controller.signal,
      );
      if (token !== version.current || controller.signal.aborted) return;
      setData(next);
      setQuery(filters);
      const view = new URLSearchParams({ tab: "crews" });
      if (filters.q) view.set("q", filters.q);
      if (filters.category) view.set("category", filters.category);
      if (filters.mine) view.set("mine", "1");
      if (next.page > 1) view.set("page", String(next.page));
      window.history.replaceState(null, "", "/players?" + view);
    } catch (cause) {
      if (token === version.current && !controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "크루를 불러오지 못했어요.");
    } finally {
      if (token === version.current && !controller.signal.aborted) setBusy(false);
    }
  }
  function search(event: FormEvent) {
    event.preventDefault();
    void load(draft);
  }
  const content = (
    <>
      <section className={embedded ? "people-section-heading" : "crew-hero"}>
        <div>
          {!embedded && (
            <span className="crew-eyebrow">
              <Handshake size={15} />
              함께 만드는 크루
            </span>
          )}
          {embedded ? <h2>같이 만들고, 오래 놀아요</h2> : <h1>같이 만들고, 오래 놀아요</h1>}
          <p>한 번의 행사에서 시작해, 다음 에피소드까지 함께할 팀을 찾아보세요.</p>
        </div>
        <Link
          className={canWrite ? "participation-primary" : "participation-secondary"}
          href={canWrite ? "/crews/new" : "/login?next=/crews/new"}
        >
          <Plus size={16} />
          크루 만들기
        </Link>
      </section>
      <form className="crew-search" onSubmit={search}>
        <div className="crew-search-input">
          <Search size={17} />
          <input
            disabled={busy}
            type="search"
            maxLength={100}
            aria-label="크루 검색"
            placeholder="크루 이름, 지역, 관심 주제"
            value={draft.q}
            onChange={(e) => setDraft((value) => ({ ...value, q: e.target.value }))}
          />
        </div>
        <select
          disabled={busy}
          aria-label="크루 주제"
          value={draft.category}
          onChange={(e) => setDraft((value) => ({ ...value, category: e.target.value }))}
        >
          <option value="">모든 주제</option>
          {CATEGORIES.map((item) => (
            <option key={item.slug} value={item.slug}>
              {item.name}
            </option>
          ))}
        </select>
        <button className="participation-primary" disabled={busy}>
          검색
        </button>
      </form>
      <div className="crew-filter-tabs" aria-label="크루 목록 선택">
        <button
          type="button"
          aria-pressed={!query.mine}
          className={!query.mine ? "active" : ""}
          disabled={busy}
          onClick={() => {
            const next = { ...draft, mine: false };
            setDraft(next);
            void load(next);
          }}
        >
          모든 크루
        </button>
        {canWrite && (
          <button
            type="button"
            aria-pressed={query.mine}
            className={query.mine ? "active" : ""}
            disabled={busy}
            onClick={() => {
              const next = { ...draft, mine: true };
              setDraft(next);
              void load(next);
            }}
          >
            내 크루
          </button>
        )}
        <span>{data.total.toLocaleString()}개 크루</span>
      </div>
      {error && (
        <p className="crew-alert" role="alert">
          {error}
          <button type="button" onClick={() => load(query, data.page)} disabled={busy}>
            다시 불러오기
          </button>
        </p>
      )}
      <div className="crew-directory" aria-busy={busy}>
        {data.items.map((crew) => (
          <Link className="crew-card" key={crew.id} href={"/crews/" + crew.id}>
            <div className="crew-card-top">
              <span className="crew-symbol">
                <Handshake size={24} />
              </span>
              <span className={"crew-state " + (crew.archived ? "is-muted" : "")}>
                {crew.archived ? "보관된 크루" : crew.recruiting ? "멤버 모집 중" : "모집 마감"}
              </span>
              <ArrowUpRight size={16} />
            </div>
            <h2>{crew.name}</h2>
            <p>{crew.description}</p>
            <div className="crew-card-meta">
              <span>
                <MapPin size={14} />
                {crew.region || "지역 자유"}
              </span>
              <span>{CATEGORIES.find((c) => c.slug === crew.category)?.name}</span>
            </div>
            <div className="crew-card-bottom">
              <span>
                <Users size={14} />
                {crew.memberCount}/{crew.capacity}명
              </span>
              <span>
                행사 {crew.eventCount}회 · 기여 {crew.contributionCount}건
              </span>
            </div>
            {crew.myRole && (
              <small className="crew-my-role">
                {crew.myRole === "owner"
                  ? "내가 이끄는 크루"
                  : crew.myRole === "manager"
                    ? "운영 중인 크루"
                    : "함께하는 크루"}
              </small>
            )}
          </Link>
        ))}
        {!data.items.length && (
          <section className="crew-empty">
            <Users size={28} />
            <h2>{query.mine ? "아직 함께하는 크루가 없어요." : "조건에 맞는 크루가 없어요."}</h2>
            <p>관심 있는 크루를 찾거나, 새로운 팀을 만들어보세요.</p>
          </section>
        )}
      </div>
      <nav className="crew-pagination" aria-label="크루 페이지">
        <button
          className="participation-secondary"
          disabled={busy || data.page <= 1}
          onClick={() => load(query, data.page - 1)}
        >
          이전
        </button>
        <span>{data.page}페이지</span>
        <button
          className="participation-secondary"
          disabled={busy || !data.nextPage}
          onClick={() => {
            if (data.nextPage) void load(query, data.nextPage);
          }}
        >
          다음
        </button>
      </nav>
    </>
  );
  return embedded ? content : <ParticipationShell>{content}</ParticipationShell>;
}
