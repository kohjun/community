"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { BadgeCheck, CalendarDays, CheckCircle2, MapPin, Sparkles, Star } from "lucide-react";
import { CATEGORIES, type CategorySlug } from "@/domain/categories";
import type { EventReviewView } from "@/domain/event-operations";
import { appRequest } from "@/lib/api-client";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

export interface ReviewComposeTarget {
  postId: string;
  title: string;
  category?: CategorySlug;
  meetupType: "event" | "lightning";
  endsAt?: string | null;
  location?: string;
  hostNickname?: string;
  qrVerified?: boolean;
}

const RATING_LABELS: Record<number, string> = {
  1: "아쉬웠어요",
  2: "조금 아쉬웠어요",
  3: "무난했어요",
  4: "즐거웠어요",
  5: "최고였어요!",
};

const QUICK_TITLES = [
  "분위기가 정말 좋았어요!",
  "진행이 알차고 재밌었어요",
  "다음에도 또 참여하고 싶어요",
];

function formatEndedDate(value: string | null | undefined) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "long",
      day: "numeric",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

export function ReviewComposeModal({
  open,
  onOpenChange,
  target,
  progressLabel,
  hasNext = false,
  onNext,
  onSnooze,
  onDismiss,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ReviewComposeTarget | null;
  progressLabel?: string;
  hasNext?: boolean;
  onNext?: () => void;
  onSnooze?: () => void;
  onDismiss?: () => void;
  onSubmitted?: (view: EventReviewView) => void;
}) {
  const [rating, setRating] = useState(5);
  const [hovered, setHovered] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submittedPostId, setSubmittedPostId] = useState<string | null>(null);
  const gate = useRef(false);

  useEffect(() => {
    if (!open || !target) return;
    setRating(5);
    setHovered(null);
    setTitle("");
    setBody("");
    setError("");
    setSubmittedPostId(null);
  }, [open, target?.postId]);

  if (!target) return null;

  const activeRating = hovered ?? rating;
  const trimmedBodyLength = body.trim().length;
  const categoryName = target.category
    ? CATEGORIES.find((item) => item.slug === target.category)?.name
    : undefined;
  const endedLabel = formatEndedDate(target.endsAt);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || gate.current) return;
    if (title.trim().length < 3) {
      setError("후기 제목을 3자 이상 입력해주세요.");
      return;
    }
    if (trimmedBodyLength < 20) {
      setError("후기 내용을 20자 이상 입력해주세요.");
      return;
    }
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await appRequest<EventReviewView>(
        `/api/participation/events/${target.postId}/reviews`,
        "POST",
        {
          title: title.trim(),
          bodyMarkdown: body.trim(),
          rating,
        },
      );
      setSubmittedPostId(next.ownReviewPostId ?? "submitted");
      onSubmitted?.(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "후기를 등록하지 못했어요.");
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="review-modal-dialog">
        {submittedPostId ? (
          <div className="review-modal-done">
            <span className="review-modal-done__icon" aria-hidden="true">
              <CheckCircle2 size={32} />
            </span>
            <DialogTitle className="review-modal-title">소중한 후기가 등록되었어요!</DialogTitle>
            <DialogDescription className="review-modal-subtitle">
              남겨주신 별점과 후기는 행사 기록 랭킹과 이야기 게시판에 함께 반영돼요.
            </DialogDescription>
            <div className="review-modal-done__stars" aria-label={`등록된 별점 ${rating}점`}>
              {[1, 2, 3, 4, 5].map((value) => (
                <Star
                  key={value}
                  size={20}
                  fill={value <= rating ? "currentColor" : "none"}
                  aria-hidden="true"
                />
              ))}
              <strong>{rating}.0</strong>
            </div>
            <div className="review-modal-actions">
              {hasNext && onNext ? (
                <button type="button" className="participation-primary" onClick={onNext}>
                  다음 모임 후기 쓰기
                </button>
              ) : (
                <button
                  type="button"
                  className="participation-primary"
                  onClick={() => onOpenChange(false)}
                >
                  확인
                </button>
              )}
              {submittedPostId !== "submitted" && (
                <Link
                  className="participation-secondary"
                  href={`/stories?post=${submittedPostId}`}
                  onClick={() => onOpenChange(false)}
                >
                  내 후기 보러 가기
                </Link>
              )}
            </div>
          </div>
        ) : (
          <form className="review-modal-form" onSubmit={(e) => void submit(e)}>
            <div className="review-modal-header">
              <div className="review-modal-badges">
                <span className="review-modal-badge review-modal-badge--type">
                  <Sparkles size={12} aria-hidden="true" />
                  {target.meetupType === "lightning" ? "번개·모임" : "이벤트·행사"}
                </span>
                {categoryName && <span className="review-modal-badge">{categoryName}</span>}
                <span className="review-modal-badge review-modal-badge--verified">
                  <BadgeCheck size={12} aria-hidden="true" />
                  {target.qrVerified ? "QR 참가 인증" : "참가 확정"}
                </span>
                {progressLabel && <span className="review-modal-progress">{progressLabel}</span>}
              </div>
              <DialogTitle className="review-modal-title">참여하신 모임은 어땠나요?</DialogTitle>
              <DialogDescription className="review-modal-subtitle">
                별점과 솔직한 후기를 남기면 다음 참가자와 행사 기록 랭킹에 큰 도움이 돼요.
              </DialogDescription>
            </div>

            <div className="review-modal-event-box">
              <strong>{target.title}</strong>
              <div className="review-modal-event-meta">
                {endedLabel && (
                  <span>
                    <CalendarDays size={13} aria-hidden="true" />
                    {endedLabel} 종료
                  </span>
                )}
                {target.location && (
                  <span>
                    <MapPin size={13} aria-hidden="true" />
                    {target.location}
                  </span>
                )}
                {target.hostNickname && <span>주최 {target.hostNickname}</span>}
              </div>
            </div>

            {error && (
              <p className="participation-error" role="alert">
                {error}
              </p>
            )}

            <fieldset className="review-modal-fieldset" disabled={busy}>
              <div className="review-star-picker">
                <span className="review-star-picker__label">만족도 별점</span>
                <div
                  className="review-star-picker__stars"
                  role="radiogroup"
                  aria-label="만족도 별점 선택"
                  onMouseLeave={() => setHovered(null)}
                >
                  {[1, 2, 3, 4, 5].map((value) => {
                    const filled = value <= activeRating;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={rating === value}
                        aria-label={`${value}점 (${RATING_LABELS[value]})`}
                        className={filled ? "is-filled" : undefined}
                        onMouseEnter={() => setHovered(value)}
                        onClick={() => setRating(value)}
                      >
                        <Star size={30} fill={filled ? "currentColor" : "none"} />
                      </button>
                    );
                  })}
                </div>
                <strong className="review-star-picker__caption">
                  {activeRating}점 · {RATING_LABELS[activeRating]}
                </strong>
              </div>

              <div className="review-modal-field">
                <label htmlFor="review-modal-title">한 줄 제목</label>
                <input
                  id="review-modal-title"
                  name="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  minLength={3}
                  maxLength={120}
                  required
                  placeholder="예) 처음 참여했는데 분위기가 너무 즐거웠어요!"
                />
                <div className="review-quick-chips" aria-label="추천 제목">
                  {QUICK_TITLES.map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => setTitle(suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>

              <div className="review-modal-field">
                <div className="review-modal-field__head">
                  <label htmlFor="review-modal-body">참가 후기</label>
                  <span
                    className={
                      trimmedBodyLength >= 20 ? "review-char-meter is-ready" : "review-char-meter"
                    }
                  >
                    {trimmedBodyLength}자 {trimmedBodyLength >= 20 ? "· 작성 가능" : "/ 20자 이상"}
                  </span>
                </div>
                <textarea
                  id="review-modal-body"
                  name="body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  minLength={20}
                  maxLength={6000}
                  rows={4}
                  required
                  placeholder="즐거웠던 순간, 진행 방식, 다음에 참여할 분들을 위한 팁을 자유롭게 남겨주세요."
                />
              </div>

              <p className="review-modal-hint">
                닉네임으로 공개되며 행사 기록과 이야기 게시판에 함께 표시돼요. (모임당 1회 작성)
              </p>

              <div className="review-modal-actions">
                <button type="submit" className="participation-primary" disabled={busy}>
                  {busy ? "후기 등록 중…" : `별점 ${rating}점으로 후기 등록`}
                </button>
                {onSnooze && (
                  <button
                    type="button"
                    className="participation-secondary"
                    disabled={busy}
                    onClick={onSnooze}
                  >
                    나중에 쓰기
                  </button>
                )}
                {onDismiss && (
                  <button
                    type="button"
                    className="review-modal-dismiss"
                    disabled={busy}
                    onClick={onDismiss}
                  >
                    이 모임은 건너뛰기
                  </button>
                )}
              </div>
            </fieldset>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
