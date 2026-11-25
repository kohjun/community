"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Flame, Search, Sparkles, X } from "lucide-react";
import {
  FALLBACK_SEARCH_SUGGESTIONS,
  keywordSearchHref,
  type SearchSuggestionsResponse,
} from "@/domain/search-trends";
import { appRequest } from "@/lib/api-client";
import { cn } from "@/lib/utils";

let sharedSuggestions: SearchSuggestionsResponse | null = null;
let sharedPromise: Promise<SearchSuggestionsResponse> | null = null;

function fetchSharedSuggestions(): Promise<SearchSuggestionsResponse> {
  if (sharedSuggestions) return Promise.resolve(sharedSuggestions);
  if (!sharedPromise) {
    sharedPromise = appRequest<SearchSuggestionsResponse>("/api/search/suggestions")
      .then((data) => {
        sharedSuggestions = data;
        return data;
      })
      .catch(() => FALLBACK_SEARCH_SUGGESTIONS);
  }
  return sharedPromise;
}

export function useSearchSuggestions(initial?: SearchSuggestionsResponse) {
  const [data, setData] = useState<SearchSuggestionsResponse>(
    initial ?? sharedSuggestions ?? FALLBACK_SEARCH_SUGGESTIONS,
  );
  useEffect(() => {
    if (initial) {
      sharedSuggestions = initial;
      return;
    }
    let alive = true;
    void fetchSharedSuggestions().then((next) => {
      if (alive) setData(next);
    });
    return () => {
      alive = false;
    };
  }, [initial]);
  return data;
}

export function useRotatingPlaceholder(
  items: SearchSuggestionsResponse["placeholders"],
  paused: boolean,
  intervalMs = 3400,
) {
  const [index, setIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (paused || reducedMotion || items.length <= 1) return;
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % items.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [paused, reducedMotion, items.length, intervalMs]);

  const safeIndex = items.length ? index % items.length : 0;
  return {
    index: safeIndex,
    current: items[safeIndex] ?? FALLBACK_SEARCH_SUGGESTIONS.placeholders[0]!,
  };
}

/**
 * Header search input with sequential animated placeholders and a live trending/recommended
 * keyword popover. Works either controlled (home feed instant filter) or standalone (/search).
 */
export function DynamicHeaderSearch({
  value,
  onChange,
  onSubmitQuery,
  className,
  ariaLabel = "모임·이야기 통합 검색",
}: {
  value?: string;
  onChange?: (next: string) => void;
  onSubmitQuery?: (keyword: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const router = useRouter();
  const [localQuery, setLocalQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const suggestions = useSearchSuggestions();
  const controlled = value !== undefined && onChange !== undefined;
  const query = controlled ? value : localQuery;
  const { index, current } = useRotatingPlaceholder(
    suggestions.placeholders,
    focused || query.length > 0,
  );

  useEffect(() => {
    if (!focused) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setFocused(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing && event.keyCode !== 229) setFocused(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [focused]);

  function applyKeyword(keyword: string) {
    setFocused(false);
    if (controlled) {
      onChange(keyword);
      requestAnimationFrame(() => onSubmitQuery?.(keyword));
      return;
    }
    setLocalQuery(keyword);
    router.push(keywordSearchHref(keyword));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      applyKeyword(current.keyword);
      return;
    }
    setFocused(false);
    if (controlled) {
      onSubmitQuery?.(trimmed);
      return;
    }
    router.push(keywordSearchHref(trimmed));
  }

  return (
    <div
      ref={wrapperRef}
      className={cn("sl-search-wrap", className)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <form className="sl-search" role="search" onSubmit={handleSubmit}>
        <div className="sl-search__field">
          <input
            type="search"
            maxLength={100}
            aria-label={ariaLabel}
            value={query}
            onFocus={() => setFocused(true)}
            onChange={(event) => {
              const next = event.target.value;
              if (controlled) onChange(next);
              else setLocalQuery(next);
            }}
            placeholder={focused ? "검색어를 입력하거나 아래 인기 키워드를 눌러보세요" : ""}
          />
          {!query && !focused && (
            <span className="sl-search__ticker" aria-hidden="true">
              <span key={index} className="sl-search__ticker-text">
                {current.prompt}
              </span>
            </span>
          )}
        </div>
        {query && (
          <button
            type="button"
            onClick={() => {
              if (controlled) onChange("");
              else setLocalQuery("");
            }}
            aria-label="검색 지우기"
          >
            <X size={15} />
          </button>
        )}
        <button type="submit" aria-label="검색 실행">
          <Search size={17} aria-hidden="true" />
        </button>
      </form>

      {focused && (
        <div className="sl-search-popover" role="region" aria-label="인기 및 추천 검색어">
          <div className="sl-search-popover__section">
            <div className="sl-search-popover__head">
              <span>
                <Flame size={13} aria-hidden="true" />
                실시간 인기 검색어
              </span>
              <Link href="/search" onClick={() => setFocused(false)}>
                통합 검색 →
              </Link>
            </div>
            <ol className="sl-search-popular-list">
              {suggestions.popular.slice(0, 6).map((item, rankIndex) => (
                <li key={item.keyword}>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyKeyword(item.keyword)}
                  >
                    <span className={cn("sl-search-rank", rankIndex < 3 && "is-top")}>
                      {rankIndex + 1}
                    </span>
                    <span className="sl-search-keyword">{item.keyword}</span>
                    {item.badge && <em className="sl-search-badge">{item.badge}</em>}
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <div className="sl-search-popover__section">
            <div className="sl-search-popover__head">
              <span>
                <Sparkles size={13} aria-hidden="true" />
                추천 키워드
              </span>
            </div>
            <div className="sl-search-chips">
              {suggestions.recommended.slice(0, 8).map((item) => (
                <button
                  key={item.keyword}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyKeyword(item.keyword)}
                >
                  #{item.keyword}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Animated placeholder input used inside the dedicated `/search` page form. */
export function DynamicUnifiedSearchInput({
  defaultValue,
  initialSuggestions,
}: {
  defaultValue: string;
  initialSuggestions: SearchSuggestionsResponse;
}) {
  const [value, setValue] = useState(defaultValue);
  const [focused, setFocused] = useState(false);
  const suggestions = useSearchSuggestions(initialSuggestions);
  const { index, current } = useRotatingPlaceholder(
    suggestions.placeholders,
    focused || value.length > 0,
  );

  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);

  return (
    <label className="unified-search-input unified-search-input--dynamic">
      <Search size={20} aria-hidden="true" />
      <span className="sl-search__field">
        <input
          type="search"
          name="q"
          value={value}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => setValue(event.target.value)}
          maxLength={100}
          placeholder={focused ? "이야기, 모집, 룰북, 템플릿, 행사 기록 검색" : ""}
          aria-label="통합 검색어"
        />
        {!value && !focused && (
          <span className="sl-search__ticker" aria-hidden="true">
            <span key={index} className="sl-search__ticker-text">
              {current.prompt}
            </span>
          </span>
        )}
      </span>
    </label>
  );
}
