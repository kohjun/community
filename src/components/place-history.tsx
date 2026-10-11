"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  Lightbulb,
  MapPin,
  Search,
} from "lucide-react";
import { CATEGORIES, type CategorySlug } from "@/domain/categories";
import type { PlaceHistoryPage, PlaceHistoryQuery } from "@/domain/place-history";
import { appRequest, RequestError } from "@/lib/api-client";
import { ParticipationShell } from "./participation-shell";
import { RecordCard, RecordPagination, recordDate } from "./event-records";

export function PlaceHistoryLogin({ placeId }: { placeId: string }) {
  return (
    <ParticipationShell>
      <section className="record-page record-empty">
        <MapPin size={30} />
        <h1>이 장소에서 쌓인 경험을 만나보세요</h1>
        <p>로그인하면 회원에게 공개된 완료 행사와 장소 운영 팁을 볼 수 있어요.</p>
        <Link
          className="participation-primary"
          href={"/login?returnTo=" + encodeURIComponent("/places/" + placeId)}
        >
          로그인하고 장소 기록 보기
        </Link>
        <Link className="record-backlink" href="/map">
          이벤트 맵으로 돌아가기
        </Link>
      </section>
    </ParticipationShell>
  );
}
export function PlaceHistoryUnavailable({ message }: { message: string }) {
  return (
    <ParticipationShell>
      <section className="record-page record-empty">
        <MapPin size={30} />
        <h1>장소 기록을 확인할 수 없어요</h1>
        <p role="alert">{message}</p>
        <Link className="participation-secondary" href="/map">
          이벤트 맵으로 돌아가기
        </Link>
      </section>
    </ParticipationShell>
  );
}
export function PlaceHistory({
  initial,
  initialFilters,
}: {
  initial: PlaceHistoryPage;
  initialFilters: PlaceHistoryQuery;
}) {
  const placeId = initial.venue.id;
  const [data, setData] = useState<PlaceHistoryPage | null>(initial);
  const [filters, setFilters] = useState(initialFilters);
  const [q, setQ] = useState(initialFilters.q);
  const [category, setCategory] = useState<CategorySlug | "">(initialFilters.category ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    if (revision === 0 && filters === initialFilters) return;
    const controller = new AbortController();
    const token = ++sequence.current;
    const params = new URLSearchParams({
      q: filters.q,
      tab: filters.tab,
      page: String(filters.page),
    });
    if (filters.category) params.set("category", filters.category);
    setBusy(true);
    setError("");
    appRequest<PlaceHistoryPage>(
      "/api/places/" + placeId + "/history?" + params,
      "GET",
      undefined,
      controller.signal,
    )
      .then((next) => {
        if (!controller.signal.aborted && token === sequence.current) setData(next);
      })
      .catch((cause) => {
        if (controller.signal.aborted || token !== sequence.current) return;
        setData(null);
        if (cause instanceof RequestError && cause.code === "UNAUTHENTICATED") setNeedsLogin(true);
        setError(cause instanceof Error ? cause.message : "장소 기록을 불러오지 못했어요.");
      })
      .finally(() => {
        if (!controller.signal.aborted && token === sequence.current) setBusy(false);
      });
    return () => controller.abort();
  }, [filters, initialFilters, placeId, revision]);
  function submit(event: FormEvent) {
    event.preventDefault();
    setFilters((before) => ({ ...before, q: q.trim(), category: category || undefined, page: 1 }));
  }
  if (needsLogin) return <PlaceHistoryLogin placeId={placeId} />;
  return (
    <ParticipationShell>
      <div className="record-page place-history-page">
        <Link className="record-backlink" href="/map">
          <ArrowLeft size={14} />
          이벤트 맵
        </Link>
        {error && (
          <section className="record-panel">
            <p className="participation-error" role="alert">
              {error}
            </p>
            <button
              className="participation-secondary"
              disabled={busy}
              onClick={() => setRevision((before) => before + 1)}
            >
              다시 불러오기
            </button>
          </section>
        )}
        {data && (
          <>
            <header className="record-heading place-history-heading">
              <div>
                <span className="record-kicker">SLIPER PLACE HISTORY</span>
                <h1>{data.venue.name}</h1>
                <p className="place-history-address">
                  <MapPin size={14} />
                  {data.venue.address}
                </p>
              </div>
              <div className="record-heading-actions">
                <Link
                  className="participation-secondary"
                  href={`/map?place=${placeId}&lat=${data.venue.latitude}&lng=${data.venue.longitude}`}
                >
                  지도에서 보기
                </Link>
                <Link className="participation-primary" href={`/lightning?venue=${placeId}&open=1`}>
                  여기서 번개 열기
                </Link>
              </div>
            </header>
            <section
              className="record-panel place-current-summary"
              aria-label="현재 공유 장소 정보"
            >
              <div className="record-tags">
                <span className="record-status">
                  {CATEGORIES.find((item) => item.slug === data.venue.categorySlug)?.name}
                </span>
                <span className="record-status">
                  {{ indoor: "실내", outdoor: "야외", mixed: "실내 · 야외" }[data.venue.spaceType]}
                </span>
                <span className="record-status">
                  {data.venue.isFree ? "무료 공간" : "유료 공간"}
                </span>
                {data.venue.capacity && (
                  <span className="record-status">공간 정원 {data.venue.capacity}명</span>
                )}
              </div>
              <p className="record-note place-summary-description">{data.venue.description}</p>
              {data.venue.feeNote && (
                <p className="record-note place-summary-description">
                  이용 요금 안내: {data.venue.feeNote}
                </p>
              )}
              <small>
                현재 장소 정보 · v{data.venue.version}. 각 행사 기록에는 연결 당시의 장소 정보가
                보존돼요.
              </small>
            </section>
            <div className="record-stat-grid" aria-label="회원에게 공개된 행사 기록 통계">
              <div>
                <span>완료 행사 기록</span>
                <strong>{data.stats.completedEvents.toLocaleString()}회</strong>
                <small>회원에게 공개된 회고</small>
              </div>
              <div>
                <span>참가 확인</span>
                <strong>{data.stats.attended.toLocaleString()}명</strong>
                <small>완료 행사별 참가 확인 합계</small>
              </div>
              <div>
                <span>QR 입장 확인</span>
                <strong>{data.stats.qrAttended.toLocaleString()}명</strong>
                <small>현장 입장에 근거한 참가</small>
              </div>
              <div>
                <span>담당자 참가 확인</span>
                <strong>{data.stats.managerAttended.toLocaleString()}명</strong>
                <small>담당자가 확인한 참가</small>
              </div>
            </div>
            <p className="record-note place-history-stat-note">
              내가 볼 수 있는 회원 공개 회고만 집계해요. 같은 사람이 여러 행사에 참가한 경우
              행사마다 포함돼요.
            </p>
            <nav className="record-tabs" aria-label="장소 기록 종류">
              <button
                type="button"
                aria-current={filters.tab === "records" ? "page" : undefined}
                disabled={busy}
                onClick={() => setFilters((before) => ({ ...before, tab: "records", page: 1 }))}
              >
                <BookOpenCheck size={15} />
                완료 행사
              </button>
              <button
                type="button"
                aria-current={filters.tab === "tips" ? "page" : undefined}
                disabled={busy}
                onClick={() => setFilters((before) => ({ ...before, tab: "tips", page: 1 }))}
              >
                <Lightbulb size={15} />
                운영 팁 {data.stats.tips.toLocaleString()}
              </button>
            </nav>
            <form className="record-filters" onSubmit={submit}>
              <label>
                행사 제목·운영 팁 검색
                <input
                  type="search"
                  value={q}
                  maxLength={100}
                  disabled={busy}
                  onChange={(event) => setQ(event.target.value)}
                  placeholder="이 장소의 행사 경험을 찾아보세요"
                />
              </label>
              <label>
                카테고리
                <select
                  value={category}
                  disabled={busy}
                  onChange={(event) => setCategory(event.target.value as CategorySlug | "")}
                >
                  <option value="">전체</option>
                  {CATEGORIES.filter((item) => item.sortOrder < 9).map((item) => (
                    <option key={item.slug} value={item.slug}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="participation-secondary" disabled={busy}>
                <Search size={15} />
                검색
              </button>
            </form>
            <section aria-live="polite" aria-busy={busy}>
              {busy ? (
                <p className="record-note" role="status">
                  장소 기록을 불러오고 있어요.
                </p>
              ) : (
                <>
                  <p className="record-note place-history-result-count">
                    {filters.tab === "tips" ? "장소 운영 팁" : "완료 행사 기록"}{" "}
                    {data.total.toLocaleString()}개 · 한 페이지에 최대 20개
                  </p>
                  {!data.items.length ? (
                    <div className="record-empty">
                      <BookOpenCheck size={28} />
                      <h2>
                        {filters.tab === "tips"
                          ? "다음 주최자를 위한 경험을 기다리고 있어요"
                          : "아직 공개된 완료 행사 기록이 없어요"}
                      </h2>
                      <p>
                        {filters.q || filters.category
                          ? "검색어나 카테고리를 바꿔 확인해보세요."
                          : "이 장소를 사용한 행사가 완료되고 회고가 회원에게 공개되면 여기에 모여요."}
                      </p>
                    </div>
                  ) : filters.tab === "records" ? (
                    <ul className="record-list">
                      {data.items.map((item) => (
                        <RecordCard key={item.record.postId} item={item.record} />
                      ))}
                    </ul>
                  ) : (
                    <div className="place-tip-grid">
                      {data.items.map((item) => (
                        <article className="place-tip-card" key={item.record.postId}>
                          <span className="record-status">
                            <Lightbulb size={12} />
                            장소 운영 팁
                          </span>
                          <Link href={"/records/" + item.record.postId}>
                            <h2>{item.record.title}</h2>
                          </Link>
                          <div className="record-meta">
                            <span>
                              <CalendarDays size={13} />
                              {recordDate(item.record.endsAt)}
                            </span>
                            <span>
                              {CATEGORIES.find((row) => row.slug === item.record.category)?.name}
                            </span>
                          </div>
                          <p className="place-tip-text place-tip-excerpt">{item.venueTips}</p>
                          <small>
                            행사 당시 {item.venue.name} · 장소 v{item.venue.version}
                          </small>
                          <Link className="record-backlink" href={"/records/" + item.record.postId}>
                            전체 회고 보기
                            <ArrowRight size={14} />
                          </Link>
                        </article>
                      ))}
                    </div>
                  )}
                </>
              )}
              <RecordPagination
                page={data.page}
                hasMore={data.hasMore}
                busy={busy}
                onChange={(page) => setFilters((before) => ({ ...before, page }))}
              />
            </section>
          </>
        )}
      </div>
    </ParticipationShell>
  );
}
