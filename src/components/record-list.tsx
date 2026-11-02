"use client";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Search,
} from "lucide-react";
import { loginHref } from "@/domain/login-return";
import { CATEGORIES, type CategorySlug } from "@/domain/categories";
import type { RecordPage, RecordSummary } from "@/domain/records";
import { appRequest } from "@/lib/api-client";
import { useAdSenseContentGuard } from "./adsense-provider";
import { ParticipationShell } from "./participation-shell";

export const recordDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(new Date(value))
    : "일정 미등록";
export const recordStatus = (status: RecordSummary["status"]) =>
  status === "published" ? "회원 공개" : status === "withdrawn" ? "공개 철회" : "기록 작성 중";
export function RecordCard({ item }: { item: RecordSummary }) {
  return (
    <li className="record-list-item">
      <div className="record-list-item-main">
        <div className="record-tags">
          <span className="record-status">
            {CATEGORIES.find((c) => c.slug === item.category)?.name}
          </span>
          {item.canEdit && <span className="record-status">{recordStatus(item.status)}</span>}
        </div>
        <Link href={"/records/" + item.postId}>
          <h3>{item.title}</h3>
        </Link>
        <div className="record-meta">
          <span>
            <CalendarDays size={13} />
            {recordDate(item.endsAt)}
          </span>
          {item.location && (
            <span>
              <MapPin size={13} />
              {item.location}
            </span>
          )}
          <span>주최 {item.hostNickname}</span>
        </div>
      </div>
      <div className="record-list-item-side">
        <div className="record-small-stat">
          <span>참가 확인</span>
          <strong>{item.attended}명</strong>
        </div>
        <div className="record-small-stat">
          <span>인증 후기 {item.reviewCount}개</span>
          <strong>{item.averageRating?.toFixed(1) ?? "—"}</strong>
        </div>
        <Link href={"/records/" + item.postId} aria-label={item.title + " 행사 기록 보기"}>
          <ArrowRight size={17} />
        </Link>
      </div>
    </li>
  );
}
export function RecordPagination({
  page,
  hasMore,
  busy = false,
  onChange,
}: {
  page: number;
  hasMore: boolean;
  busy?: boolean;
  onChange: (page: number) => void;
}) {
  return page > 1 || hasMore ? (
    <nav className="record-pagination" aria-label="기록 목록 페이지">
      <button
        disabled={busy || page === 1}
        onClick={() => onChange(page - 1)}
        aria-label="이전 페이지"
      >
        <ChevronLeft size={16} />
      </button>
      {page > 1 && (
        <button disabled={busy} onClick={() => onChange(page - 1)}>
          {page - 1}
        </button>
      )}
      <button aria-current="page" disabled>
        {page}
      </button>
      {hasMore && (
        <button disabled={busy} onClick={() => onChange(page + 1)}>
          {page + 1}
        </button>
      )}
      <button
        disabled={busy || !hasMore}
        onClick={() => onChange(page + 1)}
        aria-label="다음 페이지"
      >
        <ChevronRight size={16} />
      </button>
    </nav>
  ) : null;
}
export function RecordsLogin({
  returnTo = "/archive?tab=records",
  embedded = false,
}: {
  returnTo?: string;
  embedded?: boolean;
}) {
  useAdSenseContentGuard(true);
  const Shell = embedded ? Fragment : ParticipationShell;
  const Heading = embedded ? "h2" : "h1";
  return (
    <Shell>
      <section className="record-page record-empty workspace-record-login">
        <BookOpenCheck size={30} />
        <Heading>함께 만든 경험이 기록으로 남아요</Heading>
        <p>로그인하면 완료한 행사의 회고와 플레이어의 활동 포트폴리오를 볼 수 있어요.</p>
        <Link className="participation-primary" href={loginHref(returnTo)}>
          로그인하고 기록 보기
        </Link>
      </section>
    </Shell>
  );
}
export function RecordsList({
  libraryId,
  embedded = false,
}: { libraryId?: string; embedded?: boolean } = {}) {
  useAdSenseContentGuard(true);
  const Shell = embedded ? Fragment : ParticipationShell;
  const [data, setData] = useState<RecordPage | null>(null),
    [q, setQ] = useState(""),
    [category, setCategory] = useState<CategorySlug | "">(""),
    [mine, setMine] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const sequence = useRef(0);
  const [filters, setFilters] = useState({ q: "", category: "", mine: false, page: 1 });
  useEffect(() => {
    const controller = new AbortController(),
      token = ++sequence.current;
    const params = new URLSearchParams({
      q: filters.q,
      mine: filters.mine ? "1" : "0",
      page: String(filters.page),
    });
    if (libraryId) params.set("libraryId", libraryId);
    if (filters.category) params.set("category", filters.category);
    setBusy(true);
    setError("");
    appRequest<RecordPage>("/api/records?" + params, "GET", undefined, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted && token === sequence.current) setData(next);
      })
      .catch((cause) => {
        if (!controller.signal.aborted && token === sequence.current) {
          setData(null);
          setError(cause instanceof Error ? cause.message : "기록을 불러오지 못했어요.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && token === sequence.current) setBusy(false);
      });
    return () => controller.abort();
  }, [filters, libraryId]);
  function submit(event: FormEvent) {
    event.preventDefault();
    setFilters({ q: q.trim(), category, mine, page: 1 });
  }
  return (
    <Shell>
      <div className="record-page">
        {!embedded ? (
          <header className="record-heading">
            <div>
              <span className="record-kicker">SLIPER EVENT RECORDS</span>
              <h1>즐거움은 끝나도, 기록은 남아요</h1>
              <p>함께 만든 행사와 운영 노하우를 다음 즐거움의 출발점으로 만나보세요.</p>
            </div>
            <Link className="participation-secondary" href="/mypage?tab=events&view=hosting">
              내 행사 기록하기
            </Link>
          </header>
        ) : (
          <div className="record-heading">
            <p>완료된 행사의 회고와 운영 경험을 모아보세요.</p>
            <Link className="participation-secondary" href="/mypage?tab=events&view=hosting">
              내 행사 기록하기
            </Link>
          </div>
        )}
        {libraryId && (
          <p className="record-note">
            선택한 자료와 연결된 행사 기록이에요.{" "}
            <Link href="/archive?tab=records">모든 기록 보기 →</Link>
          </p>
        )}
        <form className="record-filters" onSubmit={submit}>
          <label>
            찾고 싶은 행사
            <input
              type="search"
              maxLength={100}
              placeholder="행사 이름으로 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <label>
            활동 분야
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as CategorySlug | "")}
            >
              <option value="">모든 분야</option>
              {CATEGORIES.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            보기
            <select
              value={mine ? "mine" : "all"}
              onChange={(e) => setMine(e.target.value === "mine")}
            >
              <option value="all">공개된 행사 기록</option>
              <option value="mine">내 행사와 작성 중인 기록</option>
            </select>
          </label>
          <button className="participation-primary" disabled={busy}>
            <Search size={15} />
            찾기
          </button>
        </form>
        {error && (
          <p className="participation-error" role="alert">
            {error}
          </p>
        )}
        {busy && !data && (
          <p className="record-note" role="status">
            행사 기록을 불러오고 있어요.
          </p>
        )}
        {data && (
          <>
            <p className="record-results-count">완료 확인된 행사를 20개씩 보여드려요.</p>
            <ul className="record-list">
              {data.items.map((item) => (
                <RecordCard key={item.postId} item={item} />
              ))}
            </ul>
            {!data.items.length && (
              <section className="record-empty">
                <BookOpenCheck size={30} />
                <h2>다음 즐거움의 첫 기록을 기다려요</h2>
                <p>
                  {mine
                    ? "담당하는 행사를 완료 확인하면 기록 초안이 만들어져요."
                    : "아직 이 조건에 맞는 공개 기록이 없어요."}
                </p>
                <Link href="/mypage?tab=events&view=hosting" className="participation-secondary">
                  내 행사 확인
                </Link>
              </section>
            )}
            <RecordPagination
              page={data.page}
              hasMore={data.hasMore}
              busy={busy}
              onChange={(page) => setFilters((before) => ({ ...before, page }))}
            />
          </>
        )}
      </div>
    </Shell>
  );
}
