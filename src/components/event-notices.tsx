"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell, Check, ArrowUpRight, RefreshCw } from "lucide-react";
import type { EventNotice, EventNoticePage } from "@/domain/event-lifecycle";
import { appRequest, RequestError } from "@/lib/api-client";

type NoticePage = EventNoticePage;
const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "일정 미정";
export function EventNotices() {
  const [data, setData] = useState<NoticePage | null>(null),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const gate = useRef(false),
    epoch = useRef(0),
    pageRef = useRef(1);
  const base = "/api/participation/notices";
  useEffect(() => {
    const abort = new AbortController();
    const read = async () => {
      if (gate.current) return;
      const token = ++epoch.current;
      try {
        const next = await appRequest<NoticePage>(
          `${base}?page=${pageRef.current}`,
          "GET",
          undefined,
          abort.signal,
        );
        if (!abort.signal.aborted && token === epoch.current) {
          setData(next);
          setError("");
        }
      } catch (cause) {
        if (!abort.signal.aborted && token === epoch.current) {
          if (
            cause instanceof RequestError &&
            ["UNAUTHENTICATED", "FORBIDDEN"].includes(cause.code ?? "")
          )
            setData(null);
          setError(cause instanceof Error ? cause.message : "변경 안내를 불러오지 못했어요.");
        }
      }
    };
    void read();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void read();
    }, 30000);
    return () => {
      epoch.current++;
      abort.abort();
      clearInterval(timer);
    };
  }, []);
  async function work(fn: () => Promise<void>) {
    if (gate.current) return;
    gate.current = true;
    epoch.current++;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (cause) {
      if (
        cause instanceof RequestError &&
        ["UNAUTHENTICATED", "FORBIDDEN"].includes(cause.code ?? "")
      )
        setData(null);
      setError(cause instanceof Error ? cause.message : "다시 시도해주세요.");
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  async function load(page = 1) {
    await work(async () => {
      const next = await appRequest<NoticePage>(`${base}?page=${page}`);
      pageRef.current = next.page;
      setData(next);
    });
  }
  async function markRead(item: EventNotice) {
    await work(async () => {
      await appRequest(`/api/participation/events/${item.postId}/notice-read`, "POST", {
        changeId: item.id,
      });
      setData(
        (prev) =>
          prev && {
            ...prev,
            unread: Math.max(0, prev.unread - (item.readAt ? 0 : 1)),
            items: prev.items.map((notice) =>
              notice.id === item.id ? { ...notice, readAt: new Date().toISOString() } : notice,
            ),
          },
      );
    });
  }
  return (
    <section className="participation-card lifecycle-notices">
      <div className="lifecycle-heading">
        <h2>
          <Bell size={18} />
          행사 변경 알림
          {data && data.unread > 0 && (
            <span className="lifecycle-count">새 안내 {data.unread}</span>
          )}
        </h2>
        <button
          className="participation-secondary"
          type="button"
          disabled={busy}
          onClick={() => void load(data?.page ?? 1)}
        >
          <RefreshCw size={14} />
          새로고침
        </button>
      </div>
      {error && (
        <p className="participation-error" role="alert">
          {error}
        </p>
      )}
      {data?.items.map((item) => (
        <article key={item.id} className={`lifecycle-notice${item.readAt ? "" : " unread"}`}>
          <div className="lifecycle-change-heading">
            <span className="lifecycle-badge">
              {item.kind === "cancel" ? "행사 취소" : "일정 변경"}
            </span>
            <time dateTime={item.createdAt}>{date(item.createdAt)}</time>
          </div>
          <h3>{item.title}</h3>
          {item.kind === "reschedule" && (
            <p className="lifecycle-notice-schedule">
              변경 전 {date(item.beforeStartsAt)}
              <br />
              <strong>
                변경 후 {date(item.startsAt)} · 종료 {date(item.endsAt)}
              </strong>
            </p>
          )}
          <p className="lifecycle-reason">{item.reason}</p>
          <p className="lifecycle-help">
            {item.kind === "cancel"
              ? "주최자 취소에 따라 전액 취소·환불을 요청할 수 있어요."
              : "참가는 유지돼요. 변경된 행사 시작 전까지 전액 취소·환불을 요청할 수 있어요."}
          </p>
          <div className="lifecycle-notice-actions">
            <Link className="participation-secondary" href={`/events/${item.postId}`}>
              행사·환불 안내 <ArrowUpRight size={14} />
            </Link>
            {!item.readAt ? (
              <button
                className="participation-secondary"
                disabled={busy}
                onClick={() => void markRead(item)}
              >
                <Check size={14} />
                확인했어요
              </button>
            ) : (
              <span className="lifecycle-read">
                <Check size={13} />
                확인한 안내
              </span>
            )}
          </div>
        </article>
      ))}
      {data && !data.items.length && (
        <p className="lifecycle-help">신청한 행사의 취소·일정 변경 안내가 여기에 표시돼요.</p>
      )}
      {!data && !error && <p className="lifecycle-help">행사 변경 알림을 확인하고 있어요.</p>}
      {data && (data.page > 1 || data.hasMore) && (
        <div className="lifecycle-pagination">
          <button
            className="participation-secondary"
            disabled={busy || data.page === 1}
            onClick={() => void load(data.page - 1)}
          >
            이전
          </button>
          <span>{data.page}페이지</span>
          <button
            className="participation-secondary"
            disabled={busy || !data.hasMore}
            onClick={() => void load(data.page + 1)}
          >
            다음
          </button>
        </div>
      )}
    </section>
  );
}
