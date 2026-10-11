"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Award, BookOpen, CalendarDays, CheckCircle2, MapPin, Pin, Users } from "lucide-react";
import type { PortfolioEvent, PortfolioTab, PortfolioView } from "@/domain/portfolio";
import { portfolioPreferenceSchema } from "@/domain/portfolio";
import { CATEGORIES, type CategorySlug } from "@/domain/categories";
import { CREDIT_ROLES } from "@/domain/records";
import { PLAYER_ROLE_LABELS } from "@/domain/player";
import { appRequest, RequestError } from "@/lib/api-client";
import { MyEventCredits } from "./event-credits";
import { RecordPagination, recordDate } from "./event-records";
const TAB_LABELS: Record<PortfolioTab, string> = {
  participation: "참가 경험",
  creation: "만든 행사",
  library: "만든 자료",
};
function PortfolioEventRow({
  item,
  isMe,
  selected,
  onFeature,
}: {
  item: PortfolioEvent;
  isMe: boolean;
  selected: boolean;
  onFeature: (item: PortfolioEvent) => void;
}) {
  return (
    <li className="record-list-item">
      <div className="record-list-item-main">
        <div className="record-tags">
          <span className="record-status">
            {CATEGORIES.find((c) => c.slug === item.category)?.name}
          </span>
          {item.roles.map((role) => (
            <span className="record-status" key={role}>
              {role === "주최자" ? "주최 기록" : role + " · 본인 수락"}
            </span>
          ))}
        </div>
        <Link href={item.href}>
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
          {item.participation && (
            <>
              <span>
                <CheckCircle2 size={13} />
                {item.participation.evidence === "qr" ? "QR 입장 확인" : "담당자 참가 확인"}
              </span>
              {item.participation.outcome === "won" && (
                <span>
                  <Award size={13} />
                  우승 · 담당자 확인
                </span>
              )}
              {item.participation.observedRole && (
                <span>{PLAYER_ROLE_LABELS[item.participation.observedRole]} · 담당자 확인</span>
              )}
            </>
          )}
        </div>
      </div>
      {isMe && (
        <button
          type="button"
          className="participation-secondary"
          aria-pressed={selected}
          aria-label={item.title + (selected ? " 대표 활동에서 해제" : " 대표 활동으로 선택")}
          onClick={() => onFeature(item)}
        >
          <Pin size={13} />
          {selected ? "대표 활동" : "대표로 선택"}
        </button>
      )}
    </li>
  );
}
export function PlayerPortfolio({ publicId, isMe }: { publicId: string; isMe: boolean }) {
  const [data, setData] = useState<PortfolioView | null>(null),
    [query, setQuery] = useState({
      tab: "creation" as PortfolioTab,
      category: "",
      role: "",
      year: "",
      page: 1,
    }),
    [category, setCategory] = useState<CategorySlug | "">(""),
    [role, setRole] = useState(""),
    [year, setYear] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [visible, setVisible] = useState(false),
    [featuredIds, setFeaturedIds] = useState<string[]>([]),
    [initialized, setInitialized] = useState(false),
    [saving, setSaving] = useState(false);
  const sequence = useRef(0),
    preferences = useRef(false),
    knownEvents = useRef(new Map<string, PortfolioEvent>());
  const endpoint = isMe ? "/api/players/me/portfolio" : "/api/players/" + publicId + "/portfolio";
  useEffect(() => {
    const controller = new AbortController(),
      token = ++sequence.current;
    const params = new URLSearchParams({ tab: query.tab, page: String(query.page) });
    if (query.category) params.set("category", query.category);
    if (query.role && query.tab === "creation") params.set("role", query.role);
    if (query.year) params.set("year", query.year);
    setBusy(true);
    setError("");
    setData(null);
    appRequest<PortfolioView>(endpoint + "?" + params, "GET", undefined, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted && token === sequence.current) {
          setData(next);
          for (const item of [...next.featured, ...next.items])
            if ("postId" in item) knownEvents.current.set(item.postId, item);
          if (!preferences.current) {
            preferences.current = true;
            setVisible(next.visible);
            setFeaturedIds(next.featuredEventIds);
            setInitialized(true);
          }
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted && token === sequence.current) {
          setData(null);
          setError(cause instanceof Error ? cause.message : "포트폴리오를 불러오지 못했어요.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && token === sequence.current) setBusy(false);
      });
    return () => controller.abort();
  }, [endpoint, query]);
  function feature(item: PortfolioEvent) {
    knownEvents.current.set(item.postId, item);
    setNotice("");
    if (featuredIds.includes(item.postId))
      setFeaturedIds((ids) => ids.filter((id) => id !== item.postId));
    else if (featuredIds.length >= 3) setError("대표 활동은 최대 3개까지 선택할 수 있어요.");
    else {
      setError("");
      setFeaturedIds((ids) => [...ids, item.postId]);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const input = portfolioPreferenceSchema.safeParse({ visible, featuredEventIds: featuredIds });
    if (!input.success) {
      setError(input.error.issues[0]?.message ?? "공개 설정을 확인해주세요.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await appRequest(endpoint, "PUT", input.data);
      setNotice("포트폴리오 공개 설정과 대표 활동을 저장했어요.");
      setQuery((previous) => ({ ...previous }));
    } catch (cause) {
      if (
        cause instanceof RequestError &&
        ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"].includes(cause.code ?? "")
      )
        setData(null);
      setError(cause instanceof Error ? cause.message : "공개 설정을 저장하지 못했어요.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="record-portfolio">
      <div className="record-heading">
        <div>
          <span className="record-kicker">YOUR PLAY PORTFOLIO</span>
          <h2 style={{ margin: "8px 0", fontSize: 21 }}>경험이 쌓이는 포트폴리오</h2>
          <p>Sliper 안에서 완료 확인된 참가 경험과 함께 만든 행사를 모아요.</p>
        </div>
        <Link className="participation-secondary" href="/records">
          행사 기록 둘러보기
        </Link>
      </div>
      {data && (
        <>
          <div className="record-stat-grid">
            <div>
              <span>완료 확인 참가</span>
              <strong>{data.summary.participated}회</strong>
              <small>
                QR {data.summary.qrAttended} · 담당자 {data.summary.managerAttended}
              </small>
            </div>
            <div>
              <span>주최한 완료 행사</span>
              <strong>{data.summary.hosted}회</strong>
              <small>주최자로 등록된 행사</small>
            </div>
            <div>
              <span>수락한 제작 경력</span>
              <strong>{data.summary.contributed}회</strong>
              <small>역할이 여러 개여도 행사당 1회</small>
            </div>
            <div>
              <span>직접 만든 자료</span>
              <strong>{data.summary.createdRulebooks + data.summary.createdTemplates}개</strong>
              <small>
                룰북 {data.summary.createdRulebooks} · 템플릿 {data.summary.createdTemplates}
              </small>
            </div>
          </div>
          {data.summary.hosted > 0 && (
            <p className="record-notice">
              주최 행사 참가 연인원 {data.summary.hostAttendeeCount.toLocaleString()}명 (QR{" "}
              {data.summary.hostQrAttendeeCount} · 담당자 {data.summary.hostManagerAttendeeCount}) ·
              행사 만족도 {data.summary.hostAverageRating?.toFixed(1) ?? "미등록"}{" "}
              {data.summary.hostAverageRating !== null ? "점" : ""} · 인증 후기{" "}
              {data.summary.hostReviewCount}개. 행사에 대한 평가이며 제작진 개인의 평점은 아니에요.
            </p>
          )}
          {data.featured.length > 0 && (
            <section aria-label="대표 활동">
              <h3 style={{ fontSize: 14 }}>
                <Pin size={14} />
                대표 활동
              </h3>
              <div className="record-featured">
                {data.featured.map((item) => (
                  <Link key={item.postId} href={item.href}>
                    <span className="record-status">
                      {CATEGORIES.find((c) => c.slug === item.category)?.name}
                    </span>
                    <h3>{item.title}</h3>
                    <small>
                      {recordDate(item.endsAt)} · {item.roles.join(" · ") || "참가 경험"}
                    </small>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
      {isMe && initialized && (
        <details className="record-panel record-profile-settings">
          <summary>포트폴리오 공개와 대표 활동 설정</summary>
          <div>
            <form onSubmit={save}>
              <div className="record-switch-line">
                <div>
                  <strong>로그인 회원에게 포트폴리오 공개</strong>
                  <p>
                    완료 행사와 수락한 제작 경력을 다른 회원에게 보여줍니다. 참가 상세는 아래 참가
                    전적 공개 설정도 함께 적용돼요.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={visible}
                  aria-label="포트폴리오 회원 공개"
                  className={"crew-switch " + (visible ? "is-on" : "")}
                  disabled={saving}
                  onClick={() => setVisible((value) => !value)}
                />
              </div>
              <p className="record-note">
                목록에서 대표 활동을 최대 3개 고른 뒤 저장해주세요. {featuredIds.length} / 3개 선택
              </p>
              <div className="record-tags">
                {featuredIds.map((id) => (
                  <button
                    type="button"
                    className="participation-secondary"
                    key={id}
                    disabled={saving}
                    onClick={() => setFeaturedIds((ids) => ids.filter((value) => value !== id))}
                  >
                    {knownEvents.current.get(id)?.title ?? "선택된 완료 행사"} · 해제
                  </button>
                ))}
              </div>
              <button className="participation-primary" disabled={saving || busy}>
                {saving ? "저장 중…" : "공개 설정 저장"}
              </button>
            </form>
          </div>
        </details>
      )}
      {isMe && <MyEventCredits onChanged={() => setQuery((before) => ({ ...before }))} />}
      {error && (
        <p className="participation-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="record-notice" role="status">
          {notice}
        </p>
      )}
      {busy && (
        <p className="record-note" role="status">
          완료 확인 기록을 불러오고 있어요.
        </p>
      )}
      <nav className="record-tabs" aria-label="포트폴리오 활동 유형">
        {Object.entries(TAB_LABELS).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            aria-current={query.tab === tab ? "page" : undefined}
            onClick={() => setQuery((before) => ({ ...before, tab: tab as PortfolioTab, page: 1 }))}
          >
            {label}
          </button>
        ))}
      </nav>
      <form
        className="record-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery((before) => ({ ...before, category, role, year, page: 1 }));
        }}
      >
        <label>
          활동 분야
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as CategorySlug | "")}
          >
            <option value="">모든 분야</option>
            {CATEGORIES.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {query.tab === "creation" && (
          <label>
            제작 역할
            <select value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="">모든 역할</option>
              {["주최자", ...CREDIT_ROLES].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          활동 연도
          <input
            type="number"
            value={year}
            min={2000}
            max={2100}
            placeholder="전체 기간"
            onChange={(event) => setYear(event.target.value)}
          />
        </label>
        <button className="participation-secondary" disabled={busy}>
          적용
        </button>
      </form>
      {data && (
        <>
          <ul className="record-list">
            {data.items.map((item) =>
              "postId" in item ? (
                <PortfolioEventRow
                  key={item.postId}
                  item={item}
                  isMe={isMe}
                  selected={featuredIds.includes(item.postId)}
                  onFeature={feature}
                />
              ) : (
                <li className="record-list-item" key={item.id}>
                  <div className="record-list-item-main">
                    <div className="record-tags">
                      <span className="record-status">
                        <BookOpen size={12} />
                        {item.kind === "template" ? "템플릿" : "룰북"}
                      </span>
                      <span className="record-status">
                        {CATEGORIES.find((c) => c.slug === item.category)?.name}
                      </span>
                    </div>
                    <Link href={item.href}>
                      <h3>{item.title}</h3>
                    </Link>
                    <p className="record-note">{item.summary}</p>
                    <div className="record-meta">
                      <span>{recordDate(item.createdAt)}</span>
                      <span>
                        {item.priceKRW ? item.priceKRW.toLocaleString() + "원" : "무료 공개"}
                      </span>
                    </div>
                  </div>
                </li>
              ),
            )}
          </ul>
          {!data.items.length && (
            <div className="record-empty">
              <Users size={25} />
              <h3>
                {query.tab === "participation" && !data.historyVisible
                  ? "참가 상세는 비공개로 설정되어 있어요"
                  : "아직 이 조건에 맞는 완료 기록이 없어요"}
              </h3>
              <p>확인된 참가와 수락한 제작 경력만 표시합니다.</p>
            </div>
          )}
          <RecordPagination
            page={data.page}
            hasMore={data.hasMore}
            busy={busy}
            onChange={(page) => setQuery((before) => ({ ...before, page }))}
          />
          <p className="record-note">
            완료 확인 기록은 기존 참가 전적과 별도입니다. 샘플·취소 행사와 미참석은 집계하지 않아요.
            QR은 참가 확인이며, 우승과 역할은 담당자가 확인한 기록입니다.
          </p>
        </>
      )}
    </section>
  );
}
