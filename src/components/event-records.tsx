"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Search,
  Star,
  Users,
} from "lucide-react";
import { CATEGORIES, type CategorySlug } from "@/domain/categories";
import type { RecordDetail, RecordPage, RecordSummary } from "@/domain/records";
import type { LibraryDetail } from "@/domain/library";
import { templateRehostingUrl } from "@/domain/template-rehosting";
import { appRequest, RequestError } from "@/lib/api-client";
import { SafetyActions } from "./safety-actions";
import { ParticipationShell } from "./participation-shell";
import { PostBody } from "./post-body";
import { RecordEditor } from "./record-editor";
import { CREDIT_STATUS_LABELS, EventCreditManager } from "./event-credits";

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
export function RecordsLogin({ returnTo = "/records" }: { returnTo?: string }) {
  return (
    <ParticipationShell>
      <section className="record-page record-empty">
        <BookOpenCheck size={30} />
        <h1>함께 만든 경험이 기록으로 남아요</h1>
        <p>로그인하면 완료한 행사의 회고와 플레이어의 활동 포트폴리오를 볼 수 있어요.</p>
        <Link
          className="participation-primary"
          href={"/login?returnTo=" + encodeURIComponent(returnTo)}
        >
          로그인하고 기록 보기
        </Link>
      </section>
    </ParticipationShell>
  );
}
export function RecordsList({ libraryId }: { libraryId?: string } = {}) {
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
    <ParticipationShell>
      <div className="record-page">
        <header className="record-heading">
          <div>
            <span className="record-kicker">SLIPER EVENT RECORDS</span>
            <h1>즐거움은 끝나도, 기록은 남아요</h1>
            <p>함께 만든 행사와 운영 노하우를 다음 즐거움의 출발점으로 만나보세요.</p>
          </div>
          <Link className="participation-secondary" href="/management">
            내 행사 기록하기
          </Link>
        </header>
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
                <Link href="/management" className="participation-secondary">
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
    </ParticipationShell>
  );
}
export function RecordDetailPage({
  postId,
  editing = false,
}: {
  postId: string;
  editing?: boolean;
}) {
  const router = useRouter();
  const [data, setData] = useState<RecordDetail | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [withdrawConfirm, setWithdrawConfirm] = useState(false),
    [templateBusy, setTemplateBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    appRequest<RecordDetail>("/api/records/" + postId, "GET", undefined, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setData(next);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "행사 기록을 불러오지 못했어요.");
      });
    return () => controller.abort();
  }, [postId]);
  async function createTemplateDraft() {
    if (!data?.canEdit || busy) return;
    setBusy(true);
    setTemplateBusy(true);
    setError("");
    try {
      const created = await appRequest<LibraryDetail>(
        "/api/records/" + postId + "/template-draft",
        "POST",
        { expectedUpdatedAt: data.updatedAt },
      );
      router.push("/archive/" + created.id + "/edit");
    } catch (cause) {
      if (
        cause instanceof RequestError &&
        ["FORBIDDEN", "UNAUTHENTICATED", "NOT_FOUND"].includes(cause.code ?? "")
      )
        setData(null);
      setError(cause instanceof Error ? cause.message : "회고에서 템플릿 초안을 만들지 못했어요.");
    } finally {
      setBusy(false);
      setTemplateBusy(false);
    }
  }
  async function withdraw() {
    if (!data || busy) return;
    setBusy(true);
    setError("");
    try {
      setData(
        await appRequest<RecordDetail>("/api/records/" + postId + "/publish", "POST", {
          expectedUpdatedAt: data.updatedAt,
          published: false,
        }),
      );
      setWithdrawConfirm(false);
    } catch (cause) {
      if (
        cause instanceof RequestError &&
        ["FORBIDDEN", "UNAUTHENTICATED", "NOT_FOUND"].includes(cause.code ?? "")
      )
        setData(null);
      setError(cause instanceof Error ? cause.message : "공개 상태를 변경하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  if (editing && data?.canEdit)
    return <RecordEditor key={data.postId} initial={data} onSaved={setData} />;
  return (
    <ParticipationShell>
      <div className="record-page">
        <Link className="record-backlink" href="/records">
          <ArrowLeft size={14} />
          행사 기록
        </Link>
        {error && (
          <p className="participation-error" role="alert">
            {error}
          </p>
        )}
        {!data && !error && (
          <p className="record-note" role="status">
            행사 기록을 불러오고 있어요.
          </p>
        )}
        {data && (
          <>
            <header className="record-heading">
              <div>
                <div className="record-tags">
                  <span className="record-status">
                    <CheckCircle2 size={12} />
                    완료 확인
                  </span>
                  <span className="record-status">
                    {CATEGORIES.find((c) => c.slug === data.category)?.name}
                  </span>
                  {data.canManage && (
                    <span className="record-status">{recordStatus(data.status)}</span>
                  )}
                </div>
                <h1>{data.title}</h1>
                <div className="record-meta">
                  <span>
                    <CalendarDays size={14} />
                    {recordDate(data.startsAt)} · 종료 {recordDate(data.endsAt)}
                  </span>
                  <span>
                    <MapPin size={14} />
                    {data.location || "장소 미등록"}
                  </span>
                  <span>
                    주최{" "}
                    {data.hostPublicId ? (
                      <Link href={"/players/" + data.hostPublicId}>{data.hostNickname}</Link>
                    ) : (
                      data.hostNickname
                    )}
                  </span>
                </div>
              </div>
              <div className="record-heading-actions">
                {data.canEdit && (
                  <Link href={"/records/" + postId + "/edit"} className="participation-primary">
                    회고 편집·발행
                  </Link>
                )}
                <Link href={"/events/" + postId} className="participation-secondary">
                  행사 정보
                </Link>
              </div>
            </header>
            {editing && !data.canEdit && (
              <p className="record-notice">
                회고는 주최자가 편집할 수 있어요. 담당자는 제작진과 참가 기록을 관리할 수 있습니다.
              </p>
            )}
            {data.status !== "published" && (
              <p className="record-notice">
                {data.status === "withdrawn"
                  ? "공개를 철회한 기록입니다."
                  : "작성 중인 기록입니다."}{" "}
                주최자와 지정 담당자에게만 보여요.
              </p>
            )}
            {data.snapshot.venue && (
              <section className="record-panel record-venue-snapshot">
                <div>
                  <span className="record-kicker">행사 당시 보존된 장소</span>
                  <h2>
                    <MapPin size={17} />
                    {data.snapshot.venue.name}
                  </h2>
                  <p className="record-note">{data.snapshot.venue.address}</p>
                  <div className="record-tags">
                    <span className="record-status">
                      {
                        { indoor: "실내", outdoor: "야외", mixed: "실내 · 야외" }[
                          data.snapshot.venue.spaceType
                        ]
                      }
                    </span>
                    <span className="record-status">
                      {data.snapshot.venue.isFree ? "무료 공간" : "유료 공간"}
                    </span>
                    {data.snapshot.venue.capacity && (
                      <span className="record-status">
                        공간 정원 {data.snapshot.venue.capacity}명
                      </span>
                    )}
                  </div>
                  <p className="record-note">
                    장소 v{data.snapshot.venue.version} · 행사에 연결할 때의 정보예요.
                  </p>
                </div>
                {data.snapshot.venue.id && (
                  <Link
                    className="participation-secondary"
                    href={"/places/" + data.snapshot.venue.id}
                  >
                    이 장소의 행사 기록 <ArrowRight size={14} />
                  </Link>
                )}
              </section>
            )}
            <div className="record-stat-grid">
              <div>
                <span>참가 확인</span>
                <strong>{data.attended}명</strong>
                <small>
                  QR {data.qrAttended} · 담당자 {data.managerAttended}
                </small>
              </div>
              <div>
                <span>QR 입장 확인</span>
                <strong>{data.qrAttended}명</strong>
                <small>현장 입장에 근거한 참가</small>
              </div>
              <div>
                <span>담당자 참가 확인</span>
                <strong>{data.managerAttended}명</strong>
                <small>담당자가 확인한 참가</small>
              </div>
              <div>
                <span>행사 만족도</span>
                <strong>{data.averageRating?.toFixed(1) ?? "—"}</strong>
                <small>인증 후기 {data.reviewCount}개</small>
              </div>
            </div>
            <section className="record-panel">
              <h2>함께 만든 행사 이야기</h2>
              <div className="record-form-grid">
                {[
                  ["기획 의도", data.purpose],
                  ["실제 진행", data.execution],
                  ["잘된 점", data.highlights],
                  ["다음에 개선할 점", data.improvements],
                ].map(([label, value]) => (
                  <div key={label}>
                    <h3>{label}</h3>
                    <p className="record-note" style={{ whiteSpace: "pre-wrap" }}>
                      {value || "아직 회고를 적지 않았어요."}
                    </p>
                  </div>
                ))}
              </div>
              {data.bodyDocument ? (
                <PostBody
                  document={data.bodyDocument}
                  body={data.bodyMarkdown}
                  images={data.images}
                  videos={data.videos}
                />
              ) : (
                <p className="record-note">사진과 영상이 담긴 운영 회고를 기다리고 있어요.</p>
              )}
            </section>
            {data.venueTips && (
              <section className="record-panel">
                <h2>
                  <MapPin size={17} />
                  장소 운영 팁
                </h2>
                <p className="record-note place-tip-text">{data.venueTips}</p>
              </section>
            )}
            <section className="record-panel">
              <h2>
                <Star size={17} />
                참가 인증 후기
              </h2>
              <p className="record-note">
                행사에 대한 만족도와 후기예요. 제작진 개인에 대한 평점은 아닙니다.
              </p>
              <div className="record-linked-list">
                {data.reviews.map((review) => (
                  <Link key={review.postId} href={review.href}>
                    <span>
                      {review.title}
                      <small> · {review.author}</small>
                    </span>
                    <span>★ {review.rating}</span>
                  </Link>
                ))}
              </div>
              {!data.reviews.length && (
                <p className="record-note">아직 등록된 인증 후기가 없어요.</p>
              )}
            </section>
            <section className="record-panel">
              <h2>
                <Users size={17} />
                함께 만든 사람들
              </h2>
              {data.hostPublicId && (
                <div className="record-credit-row">
                  <div>
                    <Link href={"/players/" + data.hostPublicId}>
                      <strong>{data.hostNickname}</strong>
                    </Link>
                    <small>주최자 · 주최 기록</small>
                  </div>
                </div>
              )}
              {data.credits.map((credit) => (
                <div className="record-credit-row" key={credit.id}>
                  <div>
                    <strong>{credit.nickname}</strong>
                    <p>{credit.note}</p>
                    <small>
                      {credit.role} · 담당자 확인{" · " + CREDIT_STATUS_LABELS[credit.status]}
                    </small>
                  </div>
                </div>
              ))}
              <p className="record-note">
                개인 경력은 담당자 확인과 당사자의 수락을 거쳐 반영됩니다. 참가자 명단은 자동으로
                공개하지 않아요.
              </p>
            </section>
            {(data.canEdit || data.snapshot.template?.id) && (
              <section className="record-panel library-record-reuse">
                <div>
                  <h2>이번 경험을 다음 행사로 이어보세요</h2>
                  <p className="record-note">
                    {data.canEdit
                      ? "기획 의도와 진행·개선 내용을 비공개 템플릿 초안으로 정리해요. 참가자 정보와 사진·영상은 복사하지 않으며, 공개 여부는 편집 후 직접 결정합니다."
                      : "사용 자료의 현재 발행본과 이용 조건을 확인하고 새로운 모임을 준비해보세요. 원래 행사의 참가자와 공지방은 복사하지 않아요."}
                  </p>
                </div>
                <div className="record-actions">
                  {data.canEdit && (
                    <button
                      className="participation-secondary"
                      type="button"
                      disabled={busy || templateBusy}
                      onClick={() => void createTemplateDraft()}
                    >
                      {templateBusy ? "초안 만드는 중…" : "회고로 템플릿 초안 만들기"}
                    </button>
                  )}
                  {data.snapshot.template?.id && (
                    <Link
                      className="participation-primary"
                      href={templateRehostingUrl(data.snapshot.template.id, postId)}
                    >
                      사용한 자료로 다음 행사 준비
                    </Link>
                  )}
                </div>
              </section>
            )}
            <section className="record-panel">
              <h2>
                <BookOpenCheck size={17} />
                자료와 연결된 이야기
              </h2>
              {data.snapshot.template && (
                <p className="record-note">
                  사용한 템플릿: {data.snapshot.template.title} ·{" "}
                  {data.snapshot.template.versionNumber
                    ? `v${data.snapshot.template.versionNumber} · 개설 당시 보존본`
                    : "이전 자료 사본 · 버전 미확인"}
                </p>
              )}
              <div className="record-linked-list">
                {data.links.map((link) => (
                  <Link key={link.kind + link.id} href={link.href}>
                    <span>{link.title}</span>
                    <ArrowRight size={15} />
                  </Link>
                ))}
              </div>
              {!data.links.length && (
                <p className="record-note">관련 이야기나 룰북을 연결하면 이곳에 표시됩니다.</p>
              )}
              <p className="record-note">유료·비공개 자료는 원본의 열람 권한을 따릅니다.</p>
            </section>
            {data.status === "published" && (
              <SafetyActions
                targetType="record"
                targetId={postId}
                canAct={true}
                isMine={data.canEdit}
                onBlocked={() => {
                  setData(null);
                  setError("차단한 주최자의 행사 기록은 표시하지 않아요.");
                }}
              />
            )}
            {data.canManage && <EventCreditManager postId={postId} />}
            {data.canEdit && data.status === "published" && (
              <section className="record-panel">
                <h2>기록 공개 관리</h2>
                {withdrawConfirm ? (
                  <>
                    <p className="record-note">
                      공개를 철회하면 주최자와 지정 담당자만 회고를 볼 수 있어요. 참가 사실과 제작진
                      경력은 별도로 보존됩니다.
                    </p>
                    <div className="record-actions">
                      <button
                        className="participation-primary"
                        disabled={busy}
                        onClick={() => void withdraw()}
                      >
                        공개 철회
                      </button>
                      <button
                        className="participation-secondary"
                        disabled={busy}
                        onClick={() => setWithdrawConfirm(false)}
                      >
                        돌아가기
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    className="participation-secondary"
                    onClick={() => setWithdrawConfirm(true)}
                  >
                    회원 공개 철회하기
                  </button>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </ParticipationShell>
  );
}
