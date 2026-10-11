"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CommunityFeed } from "@/domain/community";

export function CommunityPagination({
  pagination,
  disabled,
  onChange,
}: {
  pagination: NonNullable<CommunityFeed["pagination"]>;
  disabled: boolean;
  onChange: (page: number) => void;
}) {
  const { page, totalPages, totalItems } = pagination;
  const visiblePages = [
    ...new Set([
      1,
      totalPages,
      ...Array.from({ length: 3 }, (_, index) => page + index - 1).filter(
        (value) => value >= 1 && value <= totalPages,
      ),
    ]),
  ].sort((a, b) => a - b);
  return (
    <div className="community-pagination">
      <nav className="community-page-nav" aria-label="이야기 목록 페이지">
        <button
          type="button"
          className="community-page-direction"
          aria-label="이전 페이지"
          disabled={disabled || page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={16} aria-hidden="true" /> <span>이전</span>
        </button>
        <div className="community-page-numbers">
          {visiblePages.map((value, index) => (
            <span className="community-page-item" key={value}>
              {index > 0 && value - visiblePages[index - 1]! > 1 && (
                <span className="community-page-ellipsis" aria-hidden="true">
                  …
                </span>
              )}
              <button
                type="button"
                aria-label={`${value}페이지`}
                aria-current={value === page ? "page" : undefined}
                disabled={disabled}
                onClick={() => onChange(value)}
              >
                {value}
              </button>
            </span>
          ))}
        </div>
        <button
          type="button"
          className="community-page-direction"
          aria-label="다음 페이지"
          disabled={disabled || page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          <span>다음</span> <ChevronRight size={16} aria-hidden="true" />
        </button>
      </nav>
      <p>
        {totalItems.toLocaleString("ko-KR")}개의 이야기 · {page.toLocaleString("ko-KR")} /{" "}
        {totalPages.toLocaleString("ko-KR")} 페이지
      </p>
    </div>
  );
}
