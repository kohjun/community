"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { appRequest } from "@/lib/api-client";
import { PUSH_ONBOARDING_CHANGED_EVENT } from "@/lib/push-onboarding-events";

export interface SessionView {
  available: boolean;
  authenticated: boolean;
  nickname: string | null;
  mode?: string;
  role?: string | null;
  restricted?: boolean;
}
interface SessionState {
  session: SessionView | null;
  ready: boolean;
  revision: number;
}
interface SessionContextValue extends SessionState {
  refresh(force?: boolean): Promise<SessionView | null>;
  clearSession(): void;
}
const Context = createContext<SessionContextValue | null>(null);
const RECHECK_INTERVAL_MS = 10_000;

/** UI state only. Server endpoints still verify the user and account restrictions per request. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<SessionState>({ session: null, ready: false, revision: 0 });
  const current = useRef(state);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const lastAttempt = useRef(0);
  const pending = useRef<{
    controller: AbortController;
    promise: Promise<SessionView | null>;
  } | null>(null);
  const publish = useCallback((next: SessionState) => {
    current.current = next;
    if (mounted.current) setState(next);
  }, []);
  const clearSession = useCallback(() => {
    epoch.current++;
    pending.current?.controller.abort();
    pending.current = null;
    lastAttempt.current = 0;
    publish({ session: null, ready: true, revision: current.current.revision + 1 });
  }, [publish]);
  const refresh = useCallback(
    (force = false): Promise<SessionView | null> => {
      if (!mounted.current) return Promise.resolve(null);
      if (force) {
        clearSession();
        publish({ ...current.current, ready: false });
      }
      if (pending.current) return pending.current.promise;
      if (!force && Date.now() - lastAttempt.current < RECHECK_INTERVAL_MS)
        return Promise.resolve(current.current.session);
      lastAttempt.current = Date.now();
      const token = ++epoch.current;
      const controller = new AbortController();
      const promise = (async () => {
        try {
          const session = await appRequest<SessionView>(
            "/api/auth/session",
            "GET",
            undefined,
            controller.signal,
          );
          if (!mounted.current || controller.signal.aborted || token !== epoch.current) return null;
          publish({ session, ready: true, revision: current.current.revision + 1 });
          return session;
        } catch {
          if (mounted.current && !controller.signal.aborted && token === epoch.current)
            publish({ session: null, ready: true, revision: current.current.revision + 1 });
          return null;
        } finally {
          if (pending.current?.controller === controller) pending.current = null;
        }
      })();
      pending.current = { controller, promise };
      return promise;
    },
    [clearSession, publish],
  );

  useEffect(() => {
    mounted.current = true;
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const changed = () => void refresh(true);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener(PUSH_ONBOARDING_CHANGED_EVENT, changed);
    return () => {
      mounted.current = false;
      // Strict Mode immediately replays effects. Reuse that in-flight request, but
      // abort on a real unmount before any later response can update this provider.
      queueMicrotask(() => {
        if (mounted.current) return;
        epoch.current++;
        pending.current?.controller.abort();
        pending.current = null;
        lastAttempt.current = 0;
      });
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener(PUSH_ONBOARDING_CHANGED_EVENT, changed);
    };
  }, [refresh]);
  useEffect(() => {
    void refresh();
  }, [pathname, refresh]);

  return <Context value={{ ...state, refresh, clearSession }}>{children}</Context>;
}

export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error("SessionProvider is required.");
  return value;
}
