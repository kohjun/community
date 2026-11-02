"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { koreanDay } from "@/domain/community-time";
import { useSession } from "./session-provider";
/** Only the Korean activity date is collected. No route, content or device identifier is sent. */
export function ActivityDayTracker() {
  const pathname = usePathname(),
    recorded = useRef("");
  const { session, revision } = useSession();
  const blockedRevision = useRef<number | null>(null);
  useEffect(() => {
    if (!session?.authenticated) {
      recorded.current = "";
      return;
    }
    let pending = false;
    const controller = new AbortController();
    const visit = async () => {
      const day = koreanDay(new Date());
      if (
        pending ||
        recorded.current === day ||
        blockedRevision.current === revision ||
        document.visibilityState !== "visible"
      )
        return;
      pending = true;
      try {
        const response = await fetch("/api/analytics/visit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) blockedRevision.current = revision;
        const result = await response.json();
        if (result.ok) recorded.current = day;
      } catch {
        /* Metrics never interrupt browsing. */
      } finally {
        pending = false;
      }
    };
    const timer = setInterval(() => void visit(), 60_000);
    document.addEventListener("visibilitychange", visit);
    void visit();
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visit);
    };
  }, [pathname, session?.authenticated, revision]);
  return null;
}
