"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { koreanDay } from "@/domain/community-time";
import { PUSH_ONBOARDING_CHANGED_EVENT } from "@/lib/push-onboarding-events";
/** Only the Korean activity date is collected. No route, content or device identifier is sent. */
export function ActivityDayTracker() {
  const pathname = usePathname(),
    recorded = useRef("");
  useEffect(() => {
    let pending = false;
    const controller = new AbortController();
    const visit = async () => {
      const day = koreanDay(new Date());
      if (pending || recorded.current === day || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const response = await fetch("/api/analytics/visit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          signal: controller.signal,
        });
        const result = await response.json();
        if (result.ok) recorded.current = day;
      } catch {
        /* Metrics never interrupt browsing. */
      } finally {
        pending = false;
      }
    };
    const sessionChanged = () => {
      recorded.current = "";
      void visit();
    };
    const timer = setInterval(() => void visit(), 60_000);
    document.addEventListener("visibilitychange", visit);
    window.addEventListener(PUSH_ONBOARDING_CHANGED_EVENT, sessionChanged);
    void visit();
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visit);
      window.removeEventListener(PUSH_ONBOARDING_CHANGED_EVENT, sessionChanged);
    };
  }, [pathname]);
  return null;
}
