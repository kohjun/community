"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Bell, Check, RefreshCw, X } from "lucide-react";
import { appRequest, RequestError } from "@/lib/api-client";
import { PUSH_ONBOARDING_CHANGED_EVENT } from "@/lib/push-onboarding-events";
import type { InboxItem, UnifiedInboxPage } from "@/domain/engagement";

type NotificationContextValue = {
  unread: number;
  updateUnread: (value: number) => void;
  refreshUnread: () => Promise<void>;
};
const NotificationContext = createContext<NotificationContextValue>({
  unread: 0,
  updateUnread: () => {},
  refreshUnread: async () => {},
});

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const authenticated = useRef(false),
    mounted = useRef(false),
    epoch = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const updateUnread = useCallback((value: number) => {
    // A completed read or preview supersedes any count request already in flight.
    epoch.current++;
    pending.current?.abort();
    setUnread(Math.max(0, value));
  }, []);
  const refreshUnread = useCallback(async () => {
    if (!authenticated.current || !mounted.current) return;
    const token = ++epoch.current;
    const controller = new AbortController();
    pending.current?.abort();
    pending.current = controller;
    try {
      const data = await appRequest<UnifiedInboxPage>(
        "/api/engagement/inbox",
        "GET",
        undefined,
        controller.signal,
      );
      if (mounted.current && token === epoch.current) setUnread(data.unreadCount);
    } catch (cause) {
      if (controller.signal.aborted || token !== epoch.current || !mounted.current) return;
      if (
        cause instanceof RequestError &&
        ["UNAUTHENTICATED", "FORBIDDEN"].includes(cause.code ?? "")
      ) {
        authenticated.current = false;
        setUnread(0);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const session = new AbortController();
    let checking = false;
    const checkSession = async () => {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const result = await appRequest<{ authenticated: boolean }>(
          "/api/auth/session",
          "GET",
          undefined,
          session.signal,
        );
        if (session.signal.aborted) return;
        authenticated.current = result.authenticated;
        if (!result.authenticated) {
          epoch.current++;
          pending.current?.abort();
          setUnread(0);
        } else if (pathname !== "/notifications") {
          await refreshUnread();
        }
      } catch {
        // Keep the current count if the connection temporarily drops.
      } finally {
        checking = false;
      }
    };
    const visible = () => {
      if (document.visibilityState === "visible") void checkSession();
    };
    void checkSession();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && pathname !== "/notifications")
        void refreshUnread();
    }, 30_000);
    window.addEventListener("focus", checkSession);
    window.addEventListener(PUSH_ONBOARDING_CHANGED_EVENT, checkSession);
    document.addEventListener("visibilitychange", visible);
    return () => {
      mounted.current = false;
      authenticated.current = false;
      epoch.current++;
      session.abort();
      pending.current?.abort();
      clearInterval(timer);
      window.removeEventListener("focus", checkSession);
      window.removeEventListener(PUSH_ONBOARDING_CHANGED_EVENT, checkSession);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [pathname, refreshUnread]);

  return (
    <NotificationContext value={{ unread, updateUnread, refreshUnread }}>
      {children}
    </NotificationContext>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}

export function NotificationBell({ mobile = false, label }: { mobile?: boolean; label?: string }) {
  const { unread, updateUnread } = useNotifications();
  const pathname = usePathname(),
    router = useRouter(),
    panelId = useId();
  const [open, setOpen] = useState(false),
    [items, setItems] = useState<InboxItem[]>([]),
    [loading, setLoading] = useState(false),
    [needsLogin, setNeedsLogin] = useState(false),
    [error, setError] = useState(""),
    [reading, setReading] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    pending = useRef<AbortController | null>(null),
    interactionEpoch = useRef(0),
    readPending = useRef(false);
  useEffect(() => {
    interactionEpoch.current++;
    readPending.current = false;
    setOpen(false);
    setItems([]);
    setReading(null);
    return () => {
      interactionEpoch.current++;
    };
  }, [pathname]);
  useEffect(() => {
    const changed = () => {
      interactionEpoch.current++;
      readPending.current = false;
      setReading(null);
      pending.current?.abort();
      setOpen(false);
      setItems([]);
    };
    window.addEventListener(PUSH_ONBOARDING_CHANGED_EVENT, changed);
    return () => window.removeEventListener(PUSH_ONBOARDING_CHANGED_EVENT, changed);
  }, []);
  useEffect(() => {
    if (!open) return;
    let alive = true,
      fetching = false;
    async function load() {
      if (fetching || readPending.current || document.visibilityState === "hidden") return;
      fetching = true;
      const controller = new AbortController();
      pending.current?.abort();
      pending.current = controller;
      setLoading(true);
      setError("");
      try {
        const page = await appRequest<UnifiedInboxPage>(
          "/api/engagement/inbox?unreadOnly=true&limit=6",
          "GET",
          undefined,
          controller.signal,
        );
        if (alive && !controller.signal.aborted) {
          setItems(page.items);
          updateUnread(page.unreadCount);
          setNeedsLogin(false);
        }
      } catch (cause) {
        if (!alive || controller.signal.aborted) return;
        setItems([]);
        const denied =
          cause instanceof RequestError &&
          ["UNAUTHENTICATED", "FORBIDDEN"].includes(cause.code ?? "");
        setNeedsLogin(denied);
        if (denied) updateUnread(0);
        else setError("알림을 불러오지 못했어요. 다시 시도해주세요.");
      } finally {
        fetching = false;
        if (alive) setLoading(false);
      }
    }
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) setOpen(false);
    };
    const focusOutside = (event: FocusEvent) => {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    void load();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", focusOutside);
    document.addEventListener("keydown", escape);
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      alive = false;
      pending.current?.abort();
      window.clearInterval(timer);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", focusOutside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, revision, updateUnread]);
  async function read(item: InboxItem) {
    if (readPending.current) return false;
    readPending.current = true;
    const token = interactionEpoch.current;
    pending.current?.abort();
    setReading(item.id);
    try {
      const result = await appRequest<{ unreadCount: number }>(
        "/api/engagement/inbox/read",
        "POST",
        { id: item.id },
      );
      if (token !== interactionEpoch.current) return false;
      updateUnread(result.unreadCount);
      setItems((current) => current.filter((value) => value.id !== item.id));
    } catch (cause) {
      if (token !== interactionEpoch.current) return false;
      if (
        cause instanceof RequestError &&
        ["UNAUTHENTICATED", "FORBIDDEN"].includes(cause.code ?? "")
      ) {
        updateUnread(0);
        setItems([]);
        setNeedsLogin(true);
        return false;
      }
      // A transient receipt failure must not prevent opening the notification's target.
    } finally {
      if (token === interactionEpoch.current) {
        readPending.current = false;
        setReading(null);
      }
    }
    return token === interactionEpoch.current;
  }
  return (
    <div className={`notification-dropdown${mobile ? " is-mobile" : ""}`} ref={wrapper}>
      <button
        type="button"
        ref={trigger}
        className={
          mobile
            ? "notification-mobile-trigger"
            : label
              ? "notification-text-trigger"
              : "profile-button notification-button"
        }
        aria-label={unread > 0 ? `알림함, 읽지 않은 알림 ${unread}개` : "알림함"}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        onClick={() => {
          setItems([]);
          setNeedsLogin(false);
          setError("");
          setOpen(!open);
        }}
      >
        <Bell size={mobile ? 22 : label ? 15 : 20} aria-hidden="true" />
        {(mobile || label) && (label ?? "알림")}
        {unread > 0 &&
          (mobile || label ? (
            <span className="mobile-notification-count" aria-hidden="true">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : (
            <i aria-hidden="true" />
          ))}
      </button>
      {open && (
        <section
          id={panelId}
          className="notification-popover"
          role="dialog"
          aria-label="읽지 않은 알림"
        >
          <header>
            <div>
              <strong>읽지 않은 알림</strong>
              <span>{unread}개</span>
            </div>
            <button
              type="button"
              aria-label="알림 드롭다운 닫기"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <X size={16} />
            </button>
          </header>
          <div className="notification-popover-body" aria-busy={loading}>
            {loading && !items.length ? (
              <p className="notification-popover-empty" role="status">
                알림을 불러오는 중…
              </p>
            ) : needsLogin ? (
              <div className="notification-popover-empty">
                <p>로그인하고 내 알림을 확인하세요.</p>
                <Link href="/login?returnTo=%2Fnotifications" onClick={() => setOpen(false)}>
                  로그인하기
                </Link>
              </div>
            ) : error ? (
              <div className="notification-popover-empty">
                <p role="alert">{error}</p>
                <button type="button" onClick={() => setRevision((value) => value + 1)}>
                  <RefreshCw size={14} /> 다시 시도
                </button>
              </div>
            ) : items.length ? (
              <ul>
                {items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.url}
                      aria-disabled={reading !== null}
                      onClick={(event) => {
                        if (
                          event.button !== 0 ||
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.altKey
                        ) {
                          void read(item);
                          return;
                        }
                        event.preventDefault();
                        if (reading) return;
                        void read(item).then((proceed) => {
                          if (!proceed) return;
                          setOpen(false);
                          router.push(item.url);
                        });
                      }}
                    >
                      <span className="notification-popover-dot" aria-hidden="true" />
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.body}</p>
                        <time dateTime={item.createdAt}>
                          {new Intl.DateTimeFormat("ko-KR", {
                            timeZone: "Asia/Seoul",
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(new Date(item.createdAt))}
                        </time>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="notification-popover-empty">
                <Check size={24} aria-hidden="true" />
                <p>읽지 않은 알림이 없어요.</p>
              </div>
            )}
          </div>
          <Link
            className="notification-popover-more"
            href="/notifications"
            onClick={() => setOpen(false)}
          >
            더보기 <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </section>
      )}
    </div>
  );
}
