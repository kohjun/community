import { DISCUSSION_TYPES, DISCUSSION_LABELS } from "@/domain/discussions";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  BookOpenCheck,
  ChevronLeft,
  ChevronRight,
  Layers3,
  MessageCircle,
  Search,
  Users,
} from "lucide-react";
import { ParticipationShell } from "./participation-shell";
import { CATEGORIES } from "@/domain/categories";
import {
  SEARCH_LABELS,
  SEARCH_TYPES,
  searchHref,
  type SearchPage,
  type SearchResultType,
} from "@/domain/search";
const ICONS = {
  story: MessageCircle,
  recruitment: Users,
  rulebook: BookOpen,
  template: Layers3,
  record: BookOpenCheck,
};
const date = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});
const count = (value: number) => new Intl.NumberFormat("ko-KR").format(value);
export function UnifiedSearch({
  data,
  invalidQuery = false,
}: {
  data: SearchPage;
  invalidQuery?: boolean;
}) {
  const { query } = data;
  const firstPage = Math.max(1, Math.min(data.page - 2, data.pageCount - 4));
  const pageNumbers = Array.from(
    { length: Math.min(5, data.pageCount) },
    (_, index) => firstPage + index,
  );
  return (
    <ParticipationShell>
      <section className="unified-search-hero">
        <span>SLIPER SEARCH</span>
        <h1>다음 이야기를 찾아보세요</h1>
        <p>함께 놀 모임부터 새로운 게임 아이디어까지, 한곳에서 검색해요.</p>
      </section>
      <form className="unified-search-form" action="/search" method="get" role="search">
        <label className="unified-search-input">
          <Search size={20} aria-hidden="true" />
          <input
            type="search"
            name="q"
            defaultValue={query.q}
            maxLength={100}
            placeholder="이야기, 모집, 룰북, 템플릿, 행사 기록 검색"
            aria-label="통합 검색어"
          />
        </label>
        <select name="category" aria-label="검색 카테고리" defaultValue={query.category ?? ""}>
          <option value="">모든 카테고리</option>
          {CATEGORIES.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
        <select
          name="discussionType"
          aria-label="검색 말머리"
          defaultValue={query.discussionType ?? ""}
        >
          <option value="">모든 말머리</option>
          {DISCUSSION_TYPES.map((value) => (
            <option key={value} value={value}>
              {DISCUSSION_LABELS[value]}
            </option>
          ))}
        </select>
        <input type="hidden" name="type" value={query.type} />
        <button className="participation-primary" type="submit">
          검색
        </button>
      </form>
      {invalidQuery && (
        <p className="unified-search-alert" role="alert">
          검색 조건을 확인하고 다시 검색해주세요. 검색어는 100자까지 입력할 수 있어요.
        </p>
      )}
      <nav className="unified-search-tabs" aria-label="검색 결과 유형">
        {SEARCH_TYPES.map((type) => (
          <Link
            key={type}
            href={searchHref(query, { type, page: 1 })}
            aria-current={query.type === type ? "page" : undefined}
            className={query.type === type ? "is-active" : undefined}
          >
            {SEARCH_LABELS[type]}
            {query.q && <span>{count(data.counts[type])}</span>}
          </Link>
        ))}
      </nav>
      {!query.q ? (
        <section className="unified-search-empty">
          <Search size={30} aria-hidden="true" />
          <h2>어떤 즐거움을 찾고 있나요?</h2>
          <p>프로그램 이름, 모임 주제나 태그를 입력해보세요.</p>
          <div className="unified-search-suggestions">
            {["추리", "파티", "여행", "소개팅"].map((q) => (
              <Link key={q} href={searchHref({ q, type: "all", page: 1 })}>
                {q}
                <ArrowRight size={13} />
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <>
          <div className="unified-search-summary">
            <p>
              <strong>“{query.q}”</strong> 검색 결과 <b>{count(data.total)}</b>개
            </p>
            <span>최근 등록순</span>
          </div>
          {data.items.length ? (
            <ol className="unified-search-results">
              {data.items.map((item) => {
                const Icon = ICONS[item.type as SearchResultType];
                return (
                  <li key={`${item.type}:${item.id}`}>
                    <Link href={item.href} className="unified-search-result">
                      <div className="unified-search-result-icon">
                        <Icon size={21} aria-hidden="true" />
                      </div>
                      <div className="unified-search-result-body">
                        <div className="unified-search-result-labels">
                          <span>{SEARCH_LABELS[item.type]}</span>
                          {item.discussionType && (
                            <span>{DISCUSSION_LABELS[item.discussionType]}</span>
                          )}
                          {item.spoiler && <span>스포일러</span>}
                          <span>
                            {CATEGORIES.find((category) => category.slug === item.category)?.name ??
                              item.category}
                          </span>
                        </div>
                        <h2>{item.title}</h2>
                        <p>{item.excerpt}</p>
                        <div className="unified-search-result-meta">
                          <span>{item.author}</span>
                          <time dateTime={item.createdAt}>
                            {date.format(new Date(item.createdAt))}
                          </time>
                          {item.tags.slice(0, 3).map((tag) => (
                            <span className="unified-search-tag" key={tag}>
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </div>
                      <ChevronRight
                        className="unified-search-result-arrow"
                        size={18}
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                );
              })}
            </ol>
          ) : (
            <section className="unified-search-empty">
              <Search size={30} aria-hidden="true" />
              <h2>아직 찾는 이야기가 없어요</h2>
              <p>짧은 검색어로 바꾸거나 다른 카테고리에서도 찾아보세요.</p>
              {(query.type !== "all" || query.category) && (
                <Link
                  className="participation-secondary"
                  href={searchHref({ q: query.q, type: "all", page: 1 })}
                >
                  전체에서 다시 찾기
                </Link>
              )}
            </section>
          )}
          {data.pageCount > 1 && (
            <nav className="unified-search-pagination" aria-label="검색 결과 페이지">
              {data.page > 1 && (
                <Link
                  href={searchHref(query, { page: data.page - 1 })}
                  aria-label="이전 검색 결과 페이지"
                >
                  <ChevronLeft size={16} />
                </Link>
              )}
              {pageNumbers.map((page) => (
                <Link
                  key={page}
                  href={searchHref(query, { page })}
                  aria-current={data.page === page ? "page" : undefined}
                >
                  {page}
                </Link>
              ))}
              {data.page < data.pageCount && (
                <Link
                  href={searchHref(query, { page: data.page + 1 })}
                  aria-label="다음 검색 결과 페이지"
                >
                  <ChevronRight size={16} />
                </Link>
              )}
            </nav>
          )}
          {data.limited && (
            <p className="unified-search-limit">
              가장 최근 결과 1,000개까지 보여드려요. 검색어나 카테고리를 좁히면 더 쉽게 찾을 수
              있어요.
            </p>
          )}
        </>
      )}
    </ParticipationShell>
  );
}
