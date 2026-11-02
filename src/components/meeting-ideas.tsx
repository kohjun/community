"use client";
import Link from "next/link";
import { meetingIdeaState } from "@/domain/meeting-idea-state";
import { useState, useRef } from "react";
import { appRequest } from "@/lib/api-client";
import { CATEGORIES } from "@/domain/categories";
import type { IdeaView } from "@/domain/community-growth";
export function MeetingIdeas({
  initial,
  sourceEventId = null,
}: {
  initial: { items: IdeaView[]; hasMore: boolean };
  sourceEventId?: string | null;
}) {
  const [data, setData] = useState(initial),
    [page, setPage] = useState(1),
    [region, setRegion] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const gate = useRef(false);
  async function load(p = page, r = region) {
    setData(
      await appRequest("/api/growth/ideas?" + new URLSearchParams({ page: String(p), region: r })),
    );
    setPage(p);
  }
  async function work(fn: () => Promise<unknown>) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "다시 시도해주세요.");
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <header className="participation-heading">
        <h1>이런 모임 열어주세요</h1>
        <p>
          해보고 싶은 활동을 제안하고 관심을 모아보세요. 관심 표시는 참가 신청이나 결제가 아니에요.
        </p>
      </header>
      <details className="maturity-panel" open={!!sourceEventId}>
        <summary>새 모임 제안하기</summary>
        <form
          className="growth-form"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget,
              f = new FormData(form);
            void work(async () => {
              await appRequest("/api/growth/ideas", "POST", {
                title: f.get("title"),
                body: f.get("body"),
                category: f.get("category"),
                region: f.get("region"),
                dateFrom: f.get("dateFrom"),
                dateTo: f.get("dateTo"),
                sourceEventId,
              });
              form.reset();
              setMessage("제안을 등록했어요. 이야기에서도 댓글을 나눌 수 있어요.");
              await load(1, "");
              setRegion("");
            });
          }}
        >
          <label>
            어떤 모임인가요?
            <input
              name="title"
              required
              minLength={4}
              maxLength={120}
              placeholder="수원에서 초보자 크라임씬을 해보고 싶어요"
            />
          </label>
          <label>
            활동 지역
            <input name="region" required maxLength={60} />
          </label>
          <label>
            취향
            <select name="category">
              {CATEGORIES.map((c) => (
                <option value={c.slug} key={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            가능한 날짜부터
            <input type="date" name="dateFrom" required />
          </label>
          <label>
            가능한 날짜까지
            <input type="date" name="dateTo" required />
          </label>
          <label className="growth-wide">
            하고 싶은 활동
            <textarea
              name="body"
              required
              minLength={10}
              maxLength={5000}
              rows={4}
              placeholder="기대하는 활동, 초보 여부, 선호하는 분위기를 알려주세요."
            />
          </label>
          <p className="form-note">
            제안은 공개 이야기 글로 등록됩니다. 연락처나 참가자 개인정보는 적지 마세요.
          </p>
          <button className="participation-primary" disabled={busy}>
            제안 등록
          </button>
        </form>
      </details>
      <form
        className="maturity-actions growth-search"
        onSubmit={(e) => {
          e.preventDefault();
          void work(() => load(1));
        }}
      >
        <label>
          지역 찾기
          <input
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            maxLength={60}
            placeholder="전체 지역"
          />
        </label>
        <button disabled={busy}>찾기</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="growth-list">
        {data.items.map((v) => (
          <article className="maturity-panel" key={v.id}>
            <p className="growth-eyebrow">
              {v.region} · {v.dateFrom} ~ {v.dateTo} ·{" "}
              {meetingIdeaState(v) === "expired"
                ? "제안 기간 만료"
                : v.closed
                  ? "관심 접수 마감"
                  : "관심 모으는 중"}
            </p>
            <h2>
              <Link href={"/posts/" + v.id}>{v.title}</Link>
            </h2>
            <p className="growth-body">{v.body}</p>
            <div className="maturity-actions">
              <button
                aria-pressed={v.interested}
                disabled={busy || (v.closed && !v.interested)}
                onClick={() =>
                  void work(async () => {
                    await appRequest("/api/growth/ideas/" + v.id + "/interest", "PUT", {
                      interested: !v.interested,
                    });
                    await load();
                  })
                }
              >
                {v.interested ? "관심 취소" : "나도 관심 있어요"} · {v.count}
              </button>
              <Link href={"/posts/" + v.id}>댓글로 이야기하기</Link>
              {v.mine && (
                <button
                  disabled={busy || meetingIdeaState(v) === "expired"}
                  aria-describedby={
                    meetingIdeaState(v) === "expired" ? `idea-expired-${v.id}` : undefined
                  }
                  onClick={() =>
                    void work(async () => {
                      await appRequest("/api/growth/ideas/" + v.id + "/closed", "PUT", {
                        closed: !v.closed,
                      });
                      await load();
                    })
                  }
                >
                  {meetingIdeaState(v) === "expired"
                    ? "기간 만료 · 다시 열 수 없음"
                    : v.closed
                      ? "관심 접수 다시 열기"
                      : "관심 접수 마감"}
                </button>
              )}
            </div>
            {v.mine && meetingIdeaState(v) === "expired" && (
              <p className="form-note" id={`idea-expired-${v.id}`}>
                가능한 날짜가 지나 관심 접수를 다시 열 수 없어요. 새로운 날짜로 위에서 모임을
                제안해주세요.
              </p>
            )}
            {v.events.length > 0 && (
              <div>
                <h3>이 제안으로 열린 모임</h3>
                {v.events.map((event) => (
                  <p key={event.id}>
                    <Link href={"/events/" + event.id}>{event.title} → 참가 안내</Link>
                  </p>
                ))}
              </div>
            )}
            <details>
              <summary>주최자로 모임 연결하기</summary>
              <p>직접 만든 모집글을 연결해주세요. 관심을 표시한 이용자도 따로 신청해야 합니다.</p>
              <Link href="/mypage?tab=events&view=hosting">내 행사에서 모집글 확인</Link>
              <form
                className="maturity-actions"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  let id = String(f.get("event") ?? "").trim();
                  try {
                    if (id.startsWith("http")) {
                      const u = new URL(id);
                      if (u.origin !== location.origin) throw Error();
                      id = u.pathname.split("/").filter(Boolean).at(-1) ?? "";
                    }
                  } catch {
                    setError("현재 사이트의 모집글 주소를 넣어주세요.");
                    return;
                  }
                  void work(async () => {
                    await appRequest("/api/growth/ideas/" + v.id + "/events", "PUT", {
                      eventId: id,
                      linked: true,
                    });
                    await load();
                  });
                }}
              >
                <label>
                  모집글 주소 또는 ID
                  <input name="event" required placeholder="모집글 주소 붙여넣기" />
                </label>
                <button disabled={busy}>연결</button>
              </form>
            </details>
          </article>
        ))}
      </div>
      {!data.items.length && <p>아직 제안이 없어요. 원하는 모임을 먼저 남겨보세요.</p>}
      <nav className="maturity-actions" aria-label="모임 제안 페이지">
        <button disabled={busy || page === 1} onClick={() => void work(() => load(page - 1))}>
          이전
        </button>
        <span>{page}페이지</span>
        <button disabled={busy || !data.hasMore} onClick={() => void work(() => load(page + 1))}>
          다음
        </button>
      </nav>
    </>
  );
}
