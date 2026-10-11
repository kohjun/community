"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { BadgeCheck, Star } from "lucide-react";
import type { EventReviewView } from "@/domain/event-operations";
import { appRequest } from "@/lib/api-client";
export function VerifiedEventReviews({ postId }: { postId: string }) {
  const [data, setData] = useState<EventReviewView | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
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
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (gate.current) return;
    const fields = new FormData(event.currentTarget);
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      setData(
        await appRequest<EventReviewView>(base, "POST", {
          title: fields.get("title"),
          bodyMarkdown: fields.get("body"),
          rating: Number(fields.get("rating")),
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "후기를 등록하지 못했어요.");
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="participation-card ops-card ops-reviews">
      <h2>
        <BadgeCheck size={19} />
        참가 인증 후기
      </h2>
      <p className="ops-note">
        담당자가 QR 입장을 확인한 참가자가 행사 종료 후 남기는 후기예요. 작성한 후기는 이야기
        게시판에서도 볼 수 있어요.
      </p>
      {error && (
        <p className="participation-error" role="alert">
          {error}
        </p>
      )}
      {data?.canReview && (
        <details className="ops-review-form">
          <summary>나의 참가 후기 쓰기</summary>
          <form onSubmit={(event) => void submit(event)}>
            <fieldset disabled={busy}>
              <label>
                만족도
                <select name="rating" defaultValue="5">
                  {[5, 4, 3, 2, 1].map((value) => (
                    <option value={value} key={value}>
                      {value}점
                    </option>
                  ))}
                </select>
              </label>
              <label>
                제목
                <input
                  name="title"
                  minLength={3}
                  maxLength={120}
                  required
                  placeholder="이번 행사는 어땠나요?"
                />
              </label>
              <label>
                후기 내용
                <textarea
                  name="body"
                  minLength={20}
                  maxLength={6000}
                  rows={5}
                  required
                  placeholder="즐거웠던 점과 다음 행사에 도움이 될 이야기를 남겨주세요. (20자 이상)"
                />
              </label>
              <p className="ops-note">닉네임으로 공개되며, 행사당 한 번 작성할 수 있어요.</p>
              <button type="submit" className="participation-primary">
                {busy ? "등록 중…" : "인증 후기 등록"}
              </button>
            </fieldset>
          </form>
        </details>
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
              QR 참가 인증 · <Star size={13} />
              {review.rating}
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
      {data && !data.reviews.length && <p className="ops-note">아직 인증 후기가 없어요.</p>}
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
    </section>
  );
}
