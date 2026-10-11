"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Sparkles, Zap } from "lucide-react";
import { mobileAdAllowedPath, VisibleAdClock } from "@/lib/mobile-ad-policy";
import { AdDismissal } from "@/lib/ad-dismissal";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

let sharedDismissal: AdDismissal | null = null;
function dismissal(): AdDismissal {
  if (sharedDismissal) return sharedDismissal;
  const storage = (key: "localStorage" | "sessionStorage"): Storage | null => {
    try {
      return window[key];
    } catch {
      return null;
    }
  };
  sharedDismissal = new AdDismissal(storage("sessionStorage"), storage("localStorage"));
  return sharedDismissal;
}
function otherDialogOpen(): boolean {
  return Boolean(
    document.querySelector(
      '[role="dialog"][data-state="open"]:not([data-mobile-ad-sheet]), [role="alertdialog"][data-state="open"]',
    ),
  );
}

export function MobileAdSheet() {
  const pathname = usePathname();
  const clock = useRef(new VisibleAdClock());
  const [open, setOpen] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const openRef = useRef(false);
  const policyRef = useRef<AdDismissal | null>(null);

  useEffect(() => {
    const policy = dismissal();
    policyRef.current = policy;
    const media = window.matchMedia("(max-width: 720px)");
    const hide = () => {
      openRef.current = false;
      setOpen(false);
    };
    const check = () => {
      const focused = document.activeElement;
      const typing =
        focused instanceof HTMLElement &&
        Boolean(
          focused.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'),
        );
      const eligible =
        mobileAdAllowedPath(pathname) &&
        media.matches &&
        document.visibilityState === "visible" &&
        !otherDialogOpen() &&
        !typing;
      const ready = clock.current.tick(performance.now(), eligible);
      if (openRef.current) {
        if (!eligible) hide();
        return;
      }
      if (!ready || policy.hidden()) return;
      returnFocus.current = focused instanceof HTMLElement ? focused : null;
      // Count the impression immediately, including if another dialog interrupts the sheet.
      policy.dismissSession();
      openRef.current = true;
      setOpen(true);
    };
    const observer = new MutationObserver(() => {
      if (openRef.current && otherDialogOpen()) hide();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
    const timer = setInterval(check, 1000);
    media.addEventListener("change", check);
    document.addEventListener("visibilitychange", check);
    document.addEventListener("focusin", check);
    window.addEventListener("storage", check);
    check();
    return () => {
      clock.current.tick(performance.now(), false);
      clearInterval(timer);
      observer.disconnect();
      media.removeEventListener("change", check);
      document.removeEventListener("visibilitychange", check);
      document.removeEventListener("focusin", check);
      window.removeEventListener("storage", check);
      hide();
    };
  }, [pathname]);

  function close(today = false) {
    if (today) policyRef.current?.dismissToday();
    else policyRef.current?.dismissSession();
    openRef.current = false;
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        className="mobile-ad-sheet"
        data-mobile-ad-sheet="true"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          closeButton.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // A newly opened dialog owns focus; never return it to the page during handoff.
          if (otherDialogOpen() || document.visibilityState !== "visible") return;
          const target = returnFocus.current;
          if (target?.isConnected && target.getClientRects().length > 0)
            target.focus({ preventScroll: true });
        }}
      >
        <div className="mobile-ad-handle" aria-hidden="true" />
        <div className="mobile-ad-heading">
          <DialogTitle>슬리퍼의 새로운 즐거움</DialogTitle>
          <span>광고 · 미리보기</span>
        </div>
        <DialogDescription className="mobile-ad-description">
          가까운 사람들과, 가볍게 시작하는 우리 동네 번개.
        </DialogDescription>
        <div className="mobile-ad-slot" data-ad-slot="site-mobile-bottom">
          <Link href="/lightning" className="mobile-ad-creative" onClick={() => close()}>
            <div className="mobile-ad-brand">
              <img src="/images/sliper-logo.png" width={32} height={32} alt="" />
              <span>sliper.</span>
            </div>
            <strong>
              오늘은 가볍게,
              <br />
              <em>슬쩍 만나볼까요?</em>
            </strong>
            <p>
              취향이 맞는 사람들과 함께라면
              <br />
              평범한 하루도 새로운 에피소드.
            </p>
            <div className="mobile-ad-art" aria-hidden="true">
              <Zap size={48} strokeWidth={1.5} />
              <Sparkles size={19} />
            </div>
            <span className="mobile-ad-action">
              번개 모임 둘러보기 <ArrowUpRight size={16} />
            </span>
          </Link>
        </div>
        <div className="mobile-ad-footer">
          <button type="button" onClick={() => close(true)}>
            오늘 하루 보지 않기
          </button>
          <button ref={closeButton} type="button" onClick={() => close()}>
            닫기
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
