"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { CATEGORIES } from "@/domain/categories";
import {
  AFTERCARE_MAX_PAGE,
  AFTERCARE_PAGE_SIZE,
  type AftercareItem,
  type AftercarePage,
  type AftercareScope,
  type AftercareView,
} from "@/domain/event-aftercare";
import { appRequest } from "@/lib/api-client";

const ROLE_LABELS: Record<AftercareItem["role"], string> = {
  host: "주최자",
  manager: "담당자",
  participant: "참가자",
  contributor: "제작진",
};
const STAGE_LABELS: Record<AftercareItem["stage"], string> = {
  completion: "완료 확인",
  reflection: "회고 작성",
  credits: "제작진 확인",
  review: "참가 후기",
  ready: "다음 행사 준비",
};
const endedDate = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(date);
};
type Query = { view: AftercareView; page: number };

export function EventAftercare({
  initial,
  scope,
  title,
}: {
  initial: AftercarePage;
  scope: AftercareScope;
  title?: string;
}) {
  const headingId = useId();
  const [data, setData] = useState(initial);
  const [view, setView] = useState<AftercareView>("pending");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const activeRequest = useRef<AbortController | null>(null);
  const failedQuery = useRef<Query | null>(null);

  useEffect(() => {
    activeRequest.current?.abort();
    setData(initial);
    setView("pending");
    setBusy(false);
    setError("");
    failedQuery.current = null;
    return () => activeRequest.current?.abort();
  }, [initial, scope]);

  async function load(query: Query) {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy(true);
    setError("");
    const params = new URLSearchParams({ scope, view: query.view, page: String(query.page) });
    try {
      const next = await appRequest<AftercarePage>(
        "/api/event-aftercare?" + params,
        "GET",
        undefined,
        controller.signal,
      );
      if (controller.signal.aborted || activeRequest.current !== controller) return;
      setData(next);
      setView(query.view);
      failedQuery.current = null;
    } catch (cause) {
      if (controller.signal.aborted || activeRequest.current !== controller) return;
      failedQuery.current = query;
      setError(cause instanceof Error ? cause.message : "행사 이후 할 일을 불러오지 못했어요.");
    } finally {
      if (!controller.signal.aborted && activeRequest.current === controller) setBusy(false);
    }
  }

  const pageCount = Math.min(
    AFTERCARE_MAX_PAGE,
    Math.max(1, Math.ceil(data.total / AFTERCARE_PAGE_SIZE)),
  );
  const firstPage = Math.max(1, Math.min(data.page - 2, pageCount - 4));
  const pages = Array.from({ length: Math.min(5, pageCount) }, (_, index) => firstPage + index);
  const hosting = scope === "hosting";

  return (
    <section className="event-aftercare-panel" aria-labelledby={headingId} aria-busy={busy}>
      <header className="event-aftercare-heading">
        <div>
          <h2 id={headingId}>{title ?? (hosting ? "행사 이후 할 일" : "나의 다음 활동")}</h2>
          <p>완료 확인부터 회고, 제작 경력과 다음 행사까지 이어가세요.</p>
        </div>
        <button
          type="button"
          className="event-aftercare-refresh"
          disabled={busy}
          onClick={() => void load({ view, page: data.page })}
          aria-label="행사 이후 할 일 새로고침"
        >
          <RefreshCw size={14} aria-hidden="true" />
          새로고침
        </button>
      </header>
      <div className="event-aftercare-toolbar">
        <div className="event-aftercare-views" aria-label="행사 이후 활동 보기">
          <button
            type="button"
            aria-pressed={view === "pending"}
            onClick={() => void load({ view: "pending", page: 1 })}
          >
            해야 할 일 <span>{data.pendingTotal}</span>
          </button>
          <button
            type="button"
            aria-pressed={view === "all"}
            onClick={() => void load({ view: "all", page: 1 })}
          >
            전체 흐름
          </button>
        </div>
        <span className="event-aftercare-count">
          {data.total}개 · 페이지당 {AFTERCARE_PAGE_SIZE}개
        </span>
      </div>
      {error && (
        <div className="event-aftercare-error" role="alert">
          <p>{error} 현재 목록은 유지하고 있어요.</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void load(failedQuery.current ?? { view, page: data.page })}
          >
            다시 시도
          </button>
        </div>
      )}
      {busy && (
        <p className="event-aftercare-loading" role="status">
          목록을 확인하고 있어요.
        </p>
      )}
      {data.items.length ? (
        <ul className="event-aftercare-list">
          {data.items.map((item) => {
            const date = endedDate(item.endsAt);
            return (
              <li className="event-aftercare-item" key={item.id}>
                <div className="event-aftercare-item-main">
                  <div className="event-aftercare-item-heading">
                    <h3>{item.title}</h3>
                    <span className={"event-aftercare-label" + (item.pending ? " is-pending" : "")}>
                      {item.label}
                    </span>
                  </div>
                  <div className="event-aftercare-meta">
                    <span className="event-aftercare-role">{ROLE_LABELS[item.role]}</span>
                    <span>{STAGE_LABELS[item.stage]}</span>
                    <span>
                      {CATEGORIES.find((category) => category.slug === item.category)?.name ??
                        item.category}
                    </span>
                    {date && <span>종료 {date}</span>}
                  </div>
                  <p className="event-aftercare-description">{item.description}</p>
                </div>
                {!!item.actions.length && (
                  <div className="event-aftercare-actions">
                    {item.actions.map((action, index) => (
                      <Link
                        key={action.href + action.label}
                        className={
                          "event-aftercare-action" +
                          (index === 0 && item.pending ? " is-primary" : "")
                        }
                        href={action.href}
                        aria-label={item.title + " · " + action.label}
                      >
                        {action.label}
                        <ArrowRight size={13} aria-hidden="true" />
                      </Link>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="event-aftercare-empty">
          <h3>
            {view === "pending" ? "지금 해야 할 일은 없어요" : "아직 이어갈 행사 기록이 없어요"}
          </h3>
          <p>
            {hosting
              ? "행사를 운영하고 종료 시각이 지나면 완료 확인과 기록 작성 동선이 여기에 모여요."
              : "처음 참가한 행사에서 참가가 확인되면 후기와 기록을 이어갈 수 있어요. 제작진으로 확인된 역할은 본인 수락 후 경력으로 남아요."}
          </p>
          <div className="event-aftercare-actions">
            <Link
              className="event-aftercare-action"
              href={hosting ? "/archive?kind=template" : "/lightning"}
            >
              {hosting ? "다음 행사 준비하기" : "참가할 모임 찾기"}
              <ArrowRight size={13} aria-hidden="true" />
            </Link>
            <Link className="event-aftercare-action" href="/records">
              행사 기록 둘러보기
            </Link>
          </div>
        </div>
      )}
      {(data.page > 1 || data.hasMore) && (
        <nav className="event-aftercare-pagination" aria-label="행사 이후 할 일 페이지">
          <button
            type="button"
            disabled={busy || data.page <= 1}
            onClick={() => void load({ view, page: data.page - 1 })}
            aria-label="이전 페이지"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          {pages.map((page) => (
            <button
              type="button"
              key={page}
              disabled={busy || page === data.page}
              aria-current={page === data.page ? "page" : undefined}
              onClick={() => void load({ view, page })}
            >
              {page}
            </button>
          ))}
          <button
            type="button"
            disabled={busy || !data.hasMore}
            onClick={() => void load({ view, page: data.page + 1 })}
            aria-label="다음 페이지"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          <span>
            {data.page} / {pageCount}
          </span>
        </nav>
      )}
      <p className="event-aftercare-note">
        완료 확인과 회고는 담당 권한에 따라, 후기와 제작 경력은 참가 확인·본인 수락 조건에 따라
        표시돼요.
      </p>
    </section>
  );
}
