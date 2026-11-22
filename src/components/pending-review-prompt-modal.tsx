"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { PendingReviewPromptItem, PendingReviewsView } from "@/domain/event-operations";
import { appRequest } from "@/lib/api-client";
import { ReviewComposeModal } from "./review-compose-modal";
import { useSession } from "./session-provider";

const STORAGE_KEY = "sliper:pending-review-prompts:v1";
const SNOOZE_MS = 24 * 60 * 60 * 1000;

interface StoredPromptState {
  snoozedUntil: Record<string, number>;
  dismissed: Record<string, true>;
}

function readPromptState(): StoredPromptState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { snoozedUntil: {}, dismissed: {} };
    const parsed = JSON.parse(raw) as Partial<StoredPromptState>;
    return {
      snoozedUntil:
        parsed.snoozedUntil && typeof parsed.snoozedUntil === "object" ? parsed.snoozedUntil : {},
      dismissed: parsed.dismissed && typeof parsed.dismissed === "object" ? parsed.dismissed : {},
    };
  } catch {
    return { snoozedUntil: {}, dismissed: {} };
  }
}

function writePromptState(state: StoredPromptState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Storage quota errors never interrupt browsing. */
  }
}

function isFocusedRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/games/") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/management") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/auth")
  );
}

/**
 * Gently prompts confirmed participants of ended events & lightning meetups to rate and review
 * their experience without blocking auth, gameplay, or management workflows.
 */
export function PendingReviewPromptModal() {
  const pathname = usePathname();
  const { session, ready, revision } = useSession();
  const [queue, setQueue] = useState<PendingReviewPromptItem[]>([]);
  const [open, setOpen] = useState(false);
  const fetchedRevision = useRef<number | null>(null);
  const promptedThisVisit = useRef(false);

  useEffect(() => {
    if (!ready) return;
    if (!session?.authenticated || session.restricted) {
      fetchedRevision.current = null;
      promptedThisVisit.current = false;
      setQueue([]);
      setOpen(false);
      return;
    }
    if (isFocusedRoute(pathname)) return;
    if (fetchedRevision.current === revision) return;
    fetchedRevision.current = revision;

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    void appRequest<PendingReviewsView>(
      "/api/participation/pending-reviews",
      "GET",
      undefined,
      controller.signal,
    )
      .then((view) => {
        if (controller.signal.aborted) return;
        const stored = readPromptState();
        const now = Date.now();
        const eligible = view.items.filter(
          (item) =>
            !stored.dismissed[item.postId] && (stored.snoozedUntil[item.postId] ?? 0) <= now,
        );
        setQueue(eligible);
        if (eligible.length > 0 && !promptedThisVisit.current) {
          timer = setTimeout(() => {
            if (!controller.signal.aborted) {
              promptedThisVisit.current = true;
              setOpen(true);
            }
          }, 850);
        }
      })
      .catch(() => {
        /* Prompt checks never interrupt normal browsing. */
      });

    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [ready, session?.authenticated, session?.restricted, revision, pathname]);

  const current = queue[0] ?? null;

  function snoozeCurrent() {
    if (!current) {
      setOpen(false);
      return;
    }
    const stored = readPromptState();
    stored.snoozedUntil[current.postId] = Date.now() + SNOOZE_MS;
    writePromptState(stored);
    const remaining = queue.slice(1);
    setQueue(remaining);
    setOpen(false);
  }

  function dismissCurrent() {
    if (!current) {
      setOpen(false);
      return;
    }
    const stored = readPromptState();
    stored.dismissed[current.postId] = true;
    writePromptState(stored);
    const remaining = queue.slice(1);
    setQueue(remaining);
    if (!remaining.length) setOpen(false);
  }

  function advanceAfterSubmit() {
    const remaining = queue.slice(1);
    setQueue(remaining);
    if (!remaining.length) setOpen(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && current) {
      const stored = readPromptState();
      if (!stored.dismissed[current.postId] && !stored.snoozedUntil[current.postId]) {
        stored.snoozedUntil[current.postId] = Date.now() + SNOOZE_MS;
        writePromptState(stored);
      }
    }
    setOpen(nextOpen);
  }

  if (!current || isFocusedRoute(pathname)) return null;

  return (
    <ReviewComposeModal
      open={open}
      onOpenChange={handleOpenChange}
      target={current}
      {...(queue.length > 1 ? { progressLabel: `작성 대기 ${queue.length}건` } : {})}
      hasNext={queue.length > 1}
      onNext={advanceAfterSubmit}
      onSnooze={snoozeCurrent}
      onDismiss={dismissCurrent}
      onSubmitted={() => {
        const stored = readPromptState();
        delete stored.snoozedUntil[current.postId];
        delete stored.dismissed[current.postId];
        writePromptState(stored);
      }}
    />
  );
}
