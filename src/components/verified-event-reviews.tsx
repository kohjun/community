"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BadgeCheck, PenLine, Star } from "lucide-react";
import type { EventReviewView } from "@/domain/event-operations";
import { appRequest } from "@/lib/api-client";
import { ReviewComposeModal } from "./review-compose-modal";

export function VerifiedEventReviews({ postId }: { postId: string }) {
  const [data, setData] = useState<EventReviewView | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [composeOpen, setComposeOpen] = useState(false);
  const gate = useRef(false),
    base = `/api/participation/events/${postId}/reviews`;

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    appRequest<EventReviewView>(base, "GET", undefined, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setData(next);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "후기를 불러오지 못했어요.");
      });
    return () => controller.abort();
  }, [base]);

  async function load(page: number) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      setData(await appRequest<EventReviewView>(`${base}?page=${page}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "후기를 불러오지 못했어요.");
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }

  const averageRating =
    data && data.reviews.length > 0
      ? data.reviews.reduce((sum, item) => sum + item.rating, 0) / data.reviews.length
      : null;

  return (
    <section id="event-reviews" className="participation-card ops-card ops-reviews">
      <div className="ops-section-heading">
        <h2>
          <BadgeCheck size={19} />
          참가 후기
          {averageRating !== null && (
            <span className="ops-rating-pill">
              <Star size={14} fill="currentColor" aria-hidden="true" />
              {averageRating.toFixed(1)}
            </span>
          )}
        </h2>
        {data?.canReview && (
          <button
            type="button"
            className="participation-primary"
            onClick={() => setComposeOpen(true)}
          >
            <PenLine size={15} aria-hidden="true" />
            참가 후기 쓰기
          </button>
        )}
      </div>
      <p className="ops-note">
        참가가 확정된 인원이 종료 후 별점과 함께 남기는 후기예요. QR 입장을 확인한 참가자는 인증
        배지가 함께 표시되며, 작성한 후기는 이야기 게시판과 행사 기록에도 연결돼요.
      </p>
      {error && (
        <p className="participation-error" role="alert">
          {error}
        </p>
      )}
      {data?.ownReviewPostId && (
        <Link className="participation-secondary" href={`/stories?post=${data.ownReviewPostId}`}>
          내 후기 확인·수정
        </Link>
      )}
      {data?.reviews.map((review) => (
        <article className="ops-public-review" key={review.reviewPostId}>
          <div className="ops-section-heading">
            <strong>{review.author}</strong>
            <span className="ops-status">
              <BadgeCheck size={13} />
              {review.qrVerified ? "QR 참가 인증" : "참가 확정 후기"} ·{" "}
              <Star size={13} fill="currentColor" aria-hidden="true" />
              {review.rating}.0
            </span>
          </div>
          <Link href={`/stories?post=${review.reviewPostId}`}>
            <h3>{review.title}</h3>
          </Link>
          <p>
            {review.body.slice(0, 240)}
            {review.body.length > 240 ? "…" : ""}
          </p>
          <small>{new Date(review.createdAt).toLocaleDateString("ko-KR")}</small>
        </article>
      ))}
      {data && !data.reviews.length && <p className="ops-note">아직 등록된 참가 후기가 없어요.</p>}
      {data && (data.page > 1 || data.hasMore) && (
        <div className="ops-pagination">
          <button
            className="participation-secondary"
            disabled={busy || data.page === 1}
            onClick={() => void load(data.page - 1)}
          >
            이전
          </button>
          <span>{data.page}</span>
          <button
            className="participation-secondary"
            disabled={busy || !data.hasMore}
            onClick={() => void load(data.page + 1)}
          >
            다음
          </button>
        </div>
      )}
      {data && (
        <ReviewComposeModal
          open={composeOpen}
          onOpenChange={setComposeOpen}
          target={{
            postId: data.postId,
            title: data.title,
            meetupType: data.meetupType ?? "event",
            qrVerified: Boolean(data.checkedAt),
          }}
          onSubmitted={(updated) => setData(updated)}
        />
      )}
    </section>
  );
}
