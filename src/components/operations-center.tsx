"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import {
  OPERATION_KIND_LABELS,
  OPERATION_STAGE_LABELS,
  type OperationsAction,
  type OperationsItem,
  type OperationsPage,
  type OperationsQuery,
} from "@/domain/operations";
import { appRequest, RequestError } from "@/lib/api-client";
import { ParticipationShell } from "./participation-shell";

const ACTION_LABELS: Record<OperationsAction, string> = {
  claim: "내가 맡기",
  start_review: "검토 시작",
  release: "담당 해제",
  set_due: "목표 기한 저장",
};
const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "미입력";
const localDeadline = (value: string | null) => {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
};
const unavailableError = (cause: unknown) =>
  cause instanceof RequestError && ["FORBIDDEN", "UNAUTHENTICATED"].includes(cause.code ?? "");

export function OperationsQueueItem({
  item,
  busy = false,
  onAction,
}: {
  item: OperationsItem;
  busy?: boolean;
  onAction: (item: OperationsItem, action: OperationsAction, dueAt?: string | null) => void;
}) {
  const [deadline, setDeadline] = useState(() => localDeadline(item.dueAt));
  const allowed = item.canTriage ? item.allowedActions : [];
  useEffect(() => setDeadline(localDeadline(item.dueAt)), [item.dueAt]);
  function saveDeadline(event: FormEvent) {
    event.preventDefault();
    onAction(item, "set_due", deadline ? new Date(deadline + ":00+09:00").toISOString() : null);
  }
  return (
    <li className="operations-item">
      <div className="operations-item-heading">
        <div className="operations-tags">
          <span>{OPERATION_KIND_LABELS[item.kind]}</span>
          <span className={"operations-stage is-" + item.stage}>
            {OPERATION_STAGE_LABELS[item.stage]}
          </span>
          {item.category && <span className="operations-category">{item.category}</span>}
        </div>
        <span className="operations-date">접수 {date(item.createdAt)}</span>
      </div>
      <h2>
        <Link href={item.href}>
          {item.title}
          <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </h2>
      <p className="operations-summary">{item.summary}</p>
      <dl className="operations-meta">
        <div>
          <dt>담당</dt>
          <dd>
            {item.assignee
              ? `${item.assignee.nickname}${item.assignee.isMine ? " · 나" : ""}${item.assignee.active ? "" : " · 확인 필요"}`
              : "미배정"}
          </dd>
        </div>
        <div>
          <dt>목표 기한</dt>
          <dd>{item.dueAt ? date(item.dueAt) : "미설정"}</dd>
        </div>
        {item.reviewStartedAt && (
          <div>
            <dt>검토 시작</dt>
            <dd>{date(item.reviewStartedAt)}</dd>
          </div>
        )}
      </dl>
      {item.lastResponse ? (
        <div className="operations-response">
          <span>최종 응답{item.lastResponse.at ? " · " + date(item.lastResponse.at) : ""}</span>
          <p>{item.lastResponse.body}</p>
        </div>
      ) : (
        <p className="operations-response-empty">아직 등록된 응답이 없어요.</p>
      )}
      {item.reviewRestriction && (
        <p className="operations-response-empty">{item.reviewRestriction}</p>
      )}
      <div className="operations-actions">
        <Link className="operations-button is-primary" href={item.href}>
          내용·응답 이력 확인
          <ArrowUpRight size={13} aria-hidden="true" />
        </Link>
        {(["claim", "start_review", "release"] as const)
          .filter((action) => allowed.includes(action))
          .map((action) => (
            <button
              type="button"
              key={action}
              disabled={busy}
              onClick={() => onAction(item, action)}
            >
              {ACTION_LABELS[action]}
            </button>
          ))}
      </div>
      {allowed.includes("set_due") && (
        <form className="operations-deadline" onSubmit={saveDeadline}>
          <label>
            목표 기한 <span>한국 시간</span>
            <input
              type="datetime-local"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
              disabled={busy}
            />
          </label>
          <button type="submit" disabled={busy}>
            목표 기한 저장
          </button>
          {item.dueAt && (
            <button type="button" disabled={busy} onClick={() => onAction(item, "set_due", null)}>
              기한 해제
            </button>
          )}
        </form>
      )}
    </li>
  );
}

export function OperationsCenter({
  initial,
  initialQuery,
}: {
  initial: OperationsPage;
  initialQuery: OperationsQuery;
}) {
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const appliedQuery = useRef({ ...initialQuery, page: initial.page });
  const failedQuery = useRef<OperationsQuery | null>(null);
  const mutationGate = useRef(false);
  useEffect(() => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    mutationGate.current = false;
    appliedQuery.current = { ...initialQuery, page: initial.page };
    failedQuery.current = null;
    setData(initial);
    setQuery(appliedQuery.current);
    setLoading(false);
    setMutating(false);
    setError("");
    setNotice("");
    setUnavailable(false);
    setRefreshRequired(false);
    return () => activeRequest.current?.abort();
  }, [initial, initialQuery]);
  const isCurrent = (controller: AbortController) =>
    !controller.signal.aborted && activeRequest.current === controller;
  async function fetchPage(nextQuery: OperationsQuery, controller: AbortController) {
    const params = new URLSearchParams({
      kind: nextQuery.kind,
      stage: nextQuery.stage,
      assignment: nextQuery.assignment,
      page: String(nextQuery.page),
    });
    return appRequest<OperationsPage>(
      "/api/safety/admin/operations?" + params,
      "GET",
      undefined,
      controller.signal,
    );
  }
  function apply(next: OperationsPage, nextQuery: OperationsQuery) {
    const applied = { ...nextQuery, page: next.page };
    setData(next);
    setQuery(applied);
    appliedQuery.current = applied;
    failedQuery.current = null;
    setRefreshRequired(false);
    const params = new URLSearchParams({
      kind: applied.kind,
      stage: applied.stage,
      assignment: applied.assignment,
      page: String(applied.page),
    });
    window.history.replaceState(null, "", "/admin/operations?" + params);
  }
  async function load(nextQuery: OperationsQuery) {
    if (mutationGate.current) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setQuery(nextQuery);
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const next = await fetchPage(nextQuery, controller);
      if (isCurrent(controller)) apply(next, nextQuery);
    } catch (cause) {
      if (!isCurrent(controller)) return;
      failedQuery.current = nextQuery;
      setQuery(appliedQuery.current);
      setError(cause instanceof Error ? cause.message : "처리함을 불러오지 못했어요.");
      if (unavailableError(cause)) setUnavailable(true);
    } finally {
      if (isCurrent(controller)) setLoading(false);
    }
  }
  async function triage(item: OperationsItem, action: OperationsAction, dueAt?: string | null) {
    if (
      mutationGate.current ||
      loading ||
      refreshRequired ||
      !item.canTriage ||
      !item.allowedActions.includes(action)
    )
      return;
    mutationGate.current = true;
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    setMutating(true);
    setError("");
    setNotice("");
    try {
      await appRequest(
        `/api/safety/admin/operations/${item.kind}/${item.id}`,
        "PATCH",
        {
          action,
          expectedRevision: item.revision,
          ...(action === "set_due" ? { dueAt: dueAt ?? null } : {}),
        },
        controller.signal,
      );
      if (!isCurrent(controller)) return;
      const next = await fetchPage(appliedQuery.current, controller);
      if (!isCurrent(controller)) return;
      apply(next, appliedQuery.current);
      setNotice("담당과 목표 기한을 최신 내용으로 확인했어요.");
    } catch (cause) {
      if (!isCurrent(controller)) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "처리 결과를 확인하지 못했어요. 다시 조회해주세요.",
      );
      setRefreshRequired(true);
      if (unavailableError(cause)) setUnavailable(true);
      else if (cause instanceof RequestError && cause.code === "CONFLICT") {
        try {
          const next = await fetchPage(appliedQuery.current, controller);
          if (isCurrent(controller)) {
            apply(next, appliedQuery.current);
            setNotice("다른 담당자가 변경한 최신 내용을 불러왔어요. 확인 후 다시 진행해주세요.");
          }
        } catch (refreshError) {
          if (isCurrent(controller) && unavailableError(refreshError)) setUnavailable(true);
        }
      }
    } finally {
      if (isCurrent(controller)) {
        mutationGate.current = false;
        setMutating(false);
      }
    }
  }
  const first = Math.max(1, Math.min(data.page - 2, data.pageCount - 4));
  const pages = Array.from({ length: Math.min(5, data.pageCount) }, (_, index) => first + index);
  const busy = loading || mutating || refreshRequired;
  return (
    <ParticipationShell advertising={false}>
      <section className="operations-page">
        <nav className="operations-links" aria-label="운영 도구">
          <Link href="/admin">신고·문의 관리</Link>
          <Link href="/admin?tab=audit">처리 이력</Link>
          {data.role === "admin" && <Link href="/admin/health">운영 점검</Link>}
        </nav>
        <header className="operations-heading">
          <div>
            <span>커뮤니티 운영</span>
            <h1>통합 처리함</h1>
            <p>신고, 문의와 거래 분쟁을 확인하고 담당과 처리 목표를 정리해요.</p>
          </div>
          <button
            type="button"
            disabled={loading || mutating || unavailable}
            onClick={() => void load(appliedQuery.current)}
          >
            <RefreshCw size={14} aria-hidden="true" />
            새로고침
          </button>
        </header>
        {unavailable ? (
          <div className="operations-empty">
            <h2>처리함을 열 수 없어요</h2>
            <p>운영 권한이 있는 계정으로 다시 로그인해주세요.</p>
            <Link className="operations-button" href="/login?returnTo=/admin/operations">
              로그인
            </Link>
          </div>
        ) : (
          <>
            <div className="operations-totals" aria-label="처리 상태 현황">
              {(["pending", "reviewing", "completed"] as const).map((stage) => (
                <span key={stage}>
                  {OPERATION_STAGE_LABELS[stage]}
                  <strong>{data.counts[stage]}</strong>
                </span>
              ))}
            </div>
            <div className="operations-filters">
              <label>
                종류
                <select
                  value={query.kind}
                  disabled={mutating}
                  onChange={(event) =>
                    void load({
                      ...query,
                      kind: event.target.value as OperationsQuery["kind"],
                      page: 1,
                    })
                  }
                >
                  <option value="all">전체 종류</option>
                  {Object.entries(OPERATION_KIND_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                상태
                <select
                  value={query.stage}
                  disabled={mutating}
                  onChange={(event) =>
                    void load({
                      ...query,
                      stage: event.target.value as OperationsQuery["stage"],
                      page: 1,
                    })
                  }
                >
                  <option value="all">전체 상태</option>
                  {Object.entries(OPERATION_STAGE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                담당
                <select
                  value={query.assignment}
                  disabled={mutating}
                  onChange={(event) =>
                    void load({
                      ...query,
                      assignment: event.target.value as OperationsQuery["assignment"],
                      page: 1,
                    })
                  }
                >
                  <option value="all">모든 담당</option>
                  <option value="unassigned">미배정</option>
                  <option value="mine">내가 맡은 항목</option>
                </select>
              </label>
              <span>{data.total}건 · 20개씩 보기</span>
            </div>
            {error && (
              <div className="operations-error" role="alert">
                <p>
                  {error}
                  {refreshRequired
                    ? " 최신 내용을 확인한 후 다시 처리할 수 있어요."
                    : " 현재 목록과 조건을 유지하고 있어요."}
                </p>
                <button
                  type="button"
                  disabled={loading || mutating}
                  onClick={() => void load(failedQuery.current ?? appliedQuery.current)}
                >
                  다시 조회
                </button>
              </div>
            )}
            {notice && (
              <p className="operations-notice" role="status">
                {notice}
              </p>
            )}
            {(loading || mutating) && (
              <p className="operations-loading" role="status">
                {mutating ? "처리 결과를 확인하고 있어요." : "목록을 확인하고 있어요."}
              </p>
            )}
            {data.items.length ? (
              <ul className="operations-list" aria-busy={loading || mutating}>
                {data.items.map((item) => (
                  <OperationsQueueItem
                    key={item.kind + item.id}
                    item={item}
                    busy={busy}
                    onAction={(selected, action, dueAt) => void triage(selected, action, dueAt)}
                  />
                ))}
              </ul>
            ) : (
              <div className="operations-empty">
                <h2>해당 조건의 항목이 없어요</h2>
                <p>
                  새 신고, 문의나 분쟁이 접수되면 여기에 모여요. 종류나 상태를 바꿔 다른 항목을
                  확인할 수 있어요.
                </p>
              </div>
            )}
            {data.pageCount > 1 && (
              <nav className="operations-pagination" aria-label="통합 처리함 페이지">
                <button
                  type="button"
                  aria-label="이전 페이지"
                  disabled={busy || data.page <= 1}
                  onClick={() => void load({ ...query, page: data.page - 1 })}
                >
                  <ChevronLeft size={16} />
                </button>
                {pages.map((page) => (
                  <button
                    type="button"
                    key={page}
                    aria-current={page === data.page ? "page" : undefined}
                    disabled={busy || page === data.page}
                    onClick={() => void load({ ...query, page })}
                  >
                    {page}
                  </button>
                ))}
                <button
                  type="button"
                  aria-label="다음 페이지"
                  disabled={busy || data.page >= data.pageCount}
                  onClick={() => void load({ ...query, page: data.page + 1 })}
                >
                  <ChevronRight size={16} />
                </button>
                <span>
                  {data.page} / {data.pageCount}
                </span>
              </nav>
            )}
            <p className="operations-caption">
              담당과 기한을 정리해도 신고 조치, 문의 답변이나 분쟁 결과는 바뀌지 않아요. 내용과 처리
              이력은 원본 화면에서 확인하고 기록해주세요.
            </p>
          </>
        )}
      </section>
    </ParticipationShell>
  );
}
