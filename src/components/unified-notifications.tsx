"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Bell,
  BellRing,
  CalendarClock,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Heart,
  MessageCircle,
  Megaphone,
  RefreshCw,
  Users,
} from "lucide-react";
import { CATEGORIES, type CategorySlug } from "@/domain/categories";
import type {
  HostSubscriptionView,
  InboxItem,
  InboxKind,
  SubscriptionSettings,
  UnifiedInboxPage,
} from "@/domain/engagement";
import { appRequest, RequestError } from "@/lib/api-client";
import { ParticipationShell } from "./participation-shell";
import { PushSettings } from "./push-settings";
import { useNotifications } from "./notification-bell";

const KINDS = [
  { kind: "all", label: "전체", icon: Bell },
  { kind: "comments", label: "댓글", icon: MessageCircle },
  { kind: "announcements", label: "모임 공지", icon: Megaphone },
  { kind: "participation", label: "참가·변경", icon: Users },
  { kind: "subscriptions", label: "구독", icon: Heart },
  { kind: "reminders", label: "리마인더", icon: CalendarClock },
  { kind: "credits", label: "제작진 확인", icon: Users },
  { kind: "records", label: "행사 기록", icon: CheckCheck },
] as const;
type Filter = InboxKind | "all";
function itemLabel(kind: InboxKind) {
  return KINDS.find((item) => item.kind === kind)?.label ?? "알림";
}
function safeUrl(value: string) {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return "/notifications";
  try {
    const url = new URL(value, "https://sliper.invalid");
    return url.origin === "https://sliper.invalid"
      ? url.pathname + url.search + url.hash
      : "/notifications";
  } catch {
    return "/notifications";
  }
}
function timeLabel(value: string) {
  return new Date(value).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
export function UnifiedNotifications() {
  const router = useRouter();
  const { updateUnread } = useNotifications();
  const [kind, setKind] = useState<Filter>("all"),
    [data, setData] = useState<UnifiedInboxPage | null>(null);
  const [subscriptions, setSubscriptions] = useState<SubscriptionSettings | null>(null);
  const [categories, setCategories] = useState<CategorySlug[]>([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [subscriptionError, setSubscriptionError] = useState(""),
    [message, setMessage] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const mounted = useRef(false),
    gate = useRef(false),
    sequence = useRef(0),
    unavailable = useRef(false);
  const request = useRef<AbortController | null>(null),
    mutation = useRef<AbortController | null>(null);
  const inboxUrl = (filter: Filter, cursor?: string | null) => {
    const params = new URLSearchParams({ kind: filter });
    if (cursor) params.set("cursor", cursor);
    return "/api/engagement/inbox?" + params;
  };
  function handleError(cause: unknown, subscription = false) {
    if (!mounted.current) return;
    if (
      cause instanceof RequestError &&
      ["UNAUTHENTICATED", "FORBIDDEN"].includes(cause.code ?? "")
    ) {
      unavailable.current = true;
      setNeedsLogin(true);
      updateUnread(0);
      setData(null);
      setSubscriptions(null);
    }
    (subscription ? setSubscriptionError : setError)(
      cause instanceof Error ? cause.message : "다시 시도해주세요.",
    );
  }
  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    void appRequest<SubscriptionSettings>(
      "/api/engagement/subscriptions",
      "GET",
      undefined,
      abort.signal,
    )
      .then((value) => {
        if (abort.signal.aborted) return;
        setSubscriptions(value);
        setCategories(value.categories);
      })
      .catch((cause) => {
        if (!abort.signal.aborted) handleError(cause, true);
      });
    return () => {
      mounted.current = false;
      abort.abort();
      request.current?.abort();
      mutation.current?.abort();
      sequence.current++;
    };
  }, []);
  useEffect(() => {
    setData(null);
    setLoading(true);
    setError("");
    let active = true;
    async function fetchLatest() {
      if (gate.current || unavailable.current || !active || document.visibilityState !== "visible")
        return;
      const token = ++sequence.current;
      const abort = new AbortController();
      request.current?.abort();
      request.current = abort;
      try {
        const next = await appRequest<UnifiedInboxPage>(
          inboxUrl(kind),
          "GET",
          undefined,
          abort.signal,
        );
        if (!active || abort.signal.aborted || token !== sequence.current) return;
        updateUnread(next.unreadCount);
        unavailable.current = false;
        setNeedsLogin(false);
        setError("");
        // Refresh from the source so newly hidden or blocked notifications disappear.
        setData(next);
      } catch (cause) {
        if (active && !abort.signal.aborted && token === sequence.current) handleError(cause);
      } finally {
        if (active && token === sequence.current) setLoading(false);
      }
    }
    void fetchLatest();
    const timer = setInterval(() => void fetchLatest(), 30_000);
    const visible = () => {
      if (document.visibilityState === "visible") void fetchLatest();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      sequence.current++;
      request.current?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [kind, updateUnread]);

  async function work(task: (signal: AbortSignal) => Promise<void>, subscription = false) {
    if (gate.current || needsLogin) return;
    gate.current = true;
    if (!subscription) {
      sequence.current++;
      request.current?.abort();
      setLoading(false);
    }
    const abort = new AbortController();
    mutation.current?.abort();
    mutation.current = abort;
    setBusy(true);
    setError("");
    setSubscriptionError("");
    setMessage("");
    try {
      await task(abort.signal);
    } catch (cause) {
      if (!abort.signal.aborted) handleError(cause, subscription);
    } finally {
      gate.current = false;
      if (mounted.current && !abort.signal.aborted) setBusy(false);
    }
  }
  async function reload(signal: AbortSignal) {
    const next = await appRequest<UnifiedInboxPage>(inboxUrl(kind), "GET", undefined, signal);
    if (signal.aborted) return;
    setData(next);
    updateUnread(next.unreadCount);
  }
  async function markRead(item?: InboxItem, open = false) {
    await work(async (signal) => {
      if (!item?.readAt)
        await appRequest("/api/engagement/inbox/read", "POST", item ? { id: item.id } : {}, signal);
      if (signal.aborted) return;
      if (open && item) {
        if (!item.readAt) {
          const count = Math.max(0, (data?.unreadCount ?? 0) - 1);
          updateUnread(count);
        }
        router.push(safeUrl(item.url));
      } else {
        await reload(signal);
        if (!signal.aborted)
          setMessage(item ? "알림을 확인했어요." : "현재 알림을 모두 읽음으로 표시했어요.");
      }
    });
  }
  async function more() {
    const cursor = data?.nextCursor;
    if (!cursor) return;
    await work(async (signal) => {
      const next = await appRequest<UnifiedInboxPage>(
        inboxUrl(kind, cursor),
        "GET",
        undefined,
        signal,
      );
      if (signal.aborted) return;
      updateUnread(next.unreadCount);
      setData((previous) => {
        const seen = new Set(previous?.items.map((item) => item.id));
        return {
          ...next,
          items: [...(previous?.items ?? []), ...next.items.filter((item) => !seen.has(item.id))],
        };
      });
    });
  }
  async function saveCategories(event: FormEvent) {
    event.preventDefault();
    await work(async (signal) => {
      await appRequest("/api/engagement/subscriptions/categories", "PUT", { categories }, signal);
      const next = await appRequest<SubscriptionSettings>(
        "/api/engagement/subscriptions",
        "GET",
        undefined,
        signal,
      );
      if (!signal.aborted) {
        setSubscriptions(next);
        setCategories(next.categories);
        setMessage("관심사 구독을 저장했어요.");
      }
    }, true);
  }
  async function unsubscribe(publicId: string) {
    await work(async (signal) => {
      await appRequest<HostSubscriptionView>(
        `/api/engagement/hosts/${publicId}`,
        "PUT",
        { subscribed: false },
        signal,
      );
      if (!signal.aborted) {
        setSubscriptions(
          (previous) =>
            previous && {
              ...previous,
              hosts: previous.hosts.filter((host) => host.publicId !== publicId),
            },
        );
        setMessage("호스트 구독을 해제했어요.");
      }
    }, true);
  }
  const dirty =
    !!subscriptions &&
    (categories.length !== subscriptions.categories.length ||
      categories.some((slug) => !subscriptions.categories.includes(slug)));
  return (
    <ParticipationShell>
      <div className="inbox-workspace">
        <header className="inbox-heading">
          <div>
            <span className="inbox-eyebrow">MY SLIPER</span>
            <h1>
              알림함
              {data && data.unreadCount > 0 && (
                <span className="inbox-count">
                  {data.unreadCount > 99 ? "99+" : data.unreadCount}
                </span>
              )}
            </h1>
            <p>내 이야기와 모임의 다음 소식을 한곳에서.</p>
          </div>
          <Link className="participation-secondary" href="/participation">
            내 참가 현황
            <ChevronRight size={14} />
          </Link>
        </header>
        {needsLogin && (
          <p className="inbox-session-note" role="alert">
            로그인 상태를 다시 확인해주세요. <Link href="/login">로그인하기</Link>
          </p>
        )}
        <div className="inbox-layout">
          <section className="participation-card inbox-card" aria-label="받은 알림">
            <div className="inbox-toolbar">
              <nav className="inbox-tabs" aria-label="알림 종류">
                {KINDS.map((option) => (
                  <button
                    key={option.kind}
                    type="button"
                    aria-pressed={kind === option.kind}
                    className={kind === option.kind ? "active" : ""}
                    disabled={busy}
                    onClick={() => setKind(option.kind)}
                  >
                    {option.label}
                  </button>
                ))}
              </nav>
              <div className="inbox-tools">
                <button
                  type="button"
                  disabled={busy || loading || needsLogin}
                  onClick={() => void work(reload)}
                  aria-label="알림 새로고침"
                >
                  <RefreshCw size={15} />
                </button>
                <button
                  type="button"
                  disabled={busy || loading || !data?.unreadCount || needsLogin}
                  onClick={() => void markRead()}
                >
                  <CheckCheck size={15} />
                  현재 알림 모두 읽음
                </button>
              </div>
            </div>
            {error && (
              <p className="participation-error inbox-feedback" role="alert">
                {error}
              </p>
            )}
            {loading && !data && (
              <p className="inbox-empty" role="status">
                새로운 소식을 확인하고 있어요.
              </p>
            )}
            {!loading && data && !data.items.length && (
              <div className="inbox-empty">
                <span className="inbox-empty-icon">
                  <Bell size={24} />
                </span>
                <strong>아직 도착한 소식이 없어요</strong>
                <p>댓글과 모임 공지, 구독한 모집 소식이 여기에 모여요.</p>
              </div>
            )}
            <div className="inbox-list">
              {data?.items.map((item) => {
                const Icon = KINDS.find((option) => option.kind === item.kind)?.icon ?? Bell;
                return (
                  <article
                    key={item.id}
                    className={`inbox-item${item.readAt ? " read" : " unread"}`}
                  >
                    <span className="inbox-item-symbol" aria-hidden="true">
                      <Icon size={18} />
                    </span>
                    <div className="inbox-item-copy">
                      <div className="inbox-item-meta">
                        <span>{itemLabel(item.kind)}</span>
                        <time dateTime={item.createdAt}>{timeLabel(item.createdAt)}</time>
                        {!item.readAt && (
                          <span className="inbox-unread-dot" aria-label="읽지 않은 알림" />
                        )}
                      </div>
                      <Link
                        href={safeUrl(item.url)}
                        aria-disabled={busy}
                        onClick={(event) => {
                          if (
                            event.button !== 0 ||
                            event.metaKey ||
                            event.ctrlKey ||
                            event.shiftKey ||
                            event.altKey
                          )
                            return;
                          event.preventDefault();
                          if (!busy) void markRead(item, true);
                        }}
                      >
                        <h2>{item.title}</h2>
                        <p>{item.body}</p>
                      </Link>
                    </div>
                    {!item.readAt ? (
                      <button
                        className="inbox-read-button"
                        type="button"
                        disabled={busy}
                        aria-label={item.title + " 읽음으로 표시"}
                        onClick={() => void markRead(item)}
                      >
                        <Check size={15} />
                      </button>
                    ) : (
                      <Check className="inbox-read-icon" size={14} aria-label="읽은 알림" />
                    )}
                  </article>
                );
              })}
            </div>
            {data?.nextCursor && (
              <button
                className="inbox-more"
                type="button"
                disabled={busy}
                onClick={() => void more()}
              >
                {busy ? "불러오는 중…" : "이전 알림 더 보기"}
                <ChevronDown size={15} />
              </button>
            )}
            <p className="inbox-caption">
              20개씩 표시해요. 새 소식은 화면을 보고 있을 때 자동으로 확인해요.
            </p>
          </section>
          <aside className="inbox-settings" aria-label="구독과 알림 설정">
            <section id="interests" className="participation-card inbox-subscriptions">
              <h2>
                <Heart size={17} />
                관심사 구독
              </h2>
              <p>관심 있는 분야의 새 모집글을 받아보세요.</p>
              {subscriptionError && (
                <p className="participation-error" role="alert">
                  {subscriptionError}
                </p>
              )}
              {!subscriptions && !subscriptionError && !needsLogin && (
                <p role="status">구독 정보를 불러오고 있어요.</p>
              )}
              {subscriptions && (
                <form onSubmit={(event) => void saveCategories(event)}>
                  <div className="inbox-interest-options">
                    {CATEGORIES.map((category) => (
                      <button
                        key={category.slug}
                        type="button"
                        aria-pressed={categories.includes(category.slug)}
                        disabled={busy}
                        className={categories.includes(category.slug) ? "selected" : ""}
                        onClick={() =>
                          setCategories((previous) =>
                            previous.includes(category.slug)
                              ? previous.filter((value) => value !== category.slug)
                              : [...previous, category.slug],
                          )
                        }
                      >
                        {categories.includes(category.slug) && <Check size={12} />} {category.name}
                      </button>
                    ))}
                  </div>
                  <button type="submit" className="participation-primary" disabled={busy || !dirty}>
                    {busy ? "저장 중…" : "관심사 저장"}
                  </button>
                </form>
              )}
            </section>
            <section className="participation-card inbox-hosts">
              <h2>
                <BellRing size={17} />
                구독한 호스트
              </h2>
              <p>좋아하는 호스트의 플레이어 프로필에서 구독할 수 있어요.</p>
              {subscriptions?.hosts.length ? (
                <ul>
                  {subscriptions.hosts.map((host) => (
                    <li key={host.publicId}>
                      <Link href={`/players/${host.publicId}`}>
                        {host.nickname}
                        <ChevronRight size={13} />
                      </Link>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void unsubscribe(host.publicId)}
                      >
                        구독 해제
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="inbox-host-empty">아직 구독한 호스트가 없어요.</p>
              )}
              <Link className="inbox-settings-link" href="/players">
                플레이어 둘러보기
                <ChevronRight size={13} />
              </Link>
            </section>
            <PushSettings />
            <p className="inbox-settings-note">
              휴대폰·브라우저 알림은 위 설정에서 선택해요. 알림함에서는 소식을 계속 확인할 수
              있어요.
            </p>
          </aside>
        </div>
        {message && (
          <p className="inbox-feedback inbox-success" role="status">
            {message}
          </p>
        )}
      </div>
    </ParticipationShell>
  );
}
