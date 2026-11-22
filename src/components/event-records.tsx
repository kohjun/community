"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  MapPin,
  PenLine,
  Star,
  Users,
} from "lucide-react";
import { CATEGORIES } from "@/domain/categories";
import type { RecordDetail } from "@/domain/records";
import type { LibraryDetail } from "@/domain/library";
import { templateRehostingUrl } from "@/domain/template-rehosting";
import { appRequest, RequestError } from "@/lib/api-client";
import { SafetyActions } from "./safety-actions";
import { ParticipationShell } from "./participation-shell";
import { PostBody } from "./post-body";
import { RecordEditor } from "./record-editor";
import { ReviewComposeModal } from "./review-compose-modal";
import { CREDIT_STATUS_LABELS, EventCreditManager } from "./event-credits";

import { recordDate, recordStatus } from "./record-list";

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
    [templateBusy, setTemplateBusy] = useState(false),
    [reviewModalOpen, setReviewModalOpen] = useState(false),
    [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (reloadKey === 0) setData(null);
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
  }, [postId, reloadKey]);
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
        <Link className="record-backlink" href="/archive?tab=records">
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
            <section className="record-panel record-reviews-panel" id="record-reviews">
              <div className="record-reviews-panel__head">
                <div>
                  <h2>
                    <Star size={18} fill="#f59e0b" color="#f59e0b" aria-hidden="true" />
                    별점 및 참가 후기
                  </h2>
                  <p className="record-note">
                    참가가 확정된 인원들이 행사 종료 후 남긴 별점과 솔직한 후기예요.
                  </p>
                </div>
                <div className="record-actions">
                  {data.canReview && (
                    <button
                      type="button"
                      className="participation-primary"
                      onClick={() => setReviewModalOpen(true)}
                    >
                      <PenLine size={15} aria-hidden="true" />
                      참가 후기 쓰기
                    </button>
                  )}
                  {data.ownReviewPostId && (
                    <Link
                      className="participation-secondary"
                      href={`/stories?post=${data.ownReviewPostId}`}
                    >
                      내 후기 보기
                    </Link>
                  )}
                </div>
              </div>

              <div className="record-rating-summary">
                <div className="record-rating-score">
                  <strong>
                    {data.averageRating !== null ? data.averageRating.toFixed(1) : "—"}
                  </strong>
                  <div
                    className="record-rating-stars"
                    aria-label={
                      data.averageRating !== null
                        ? `평균 별점 ${data.averageRating.toFixed(1)}점`
                        : "아직 별점 없음"
                    }
                  >
                    {[1, 2, 3, 4, 5].map((value) => {
                      const active =
                        data.averageRating !== null && value <= Math.round(data.averageRating);
                      return (
                        <Star
                          key={value}
                          size={16}
                          fill={active ? "currentColor" : "none"}
                          aria-hidden="true"
                        />
                      );
                    })}
                  </div>
                  <small>참가 후기 {data.reviewCount}개</small>
                </div>
                <div className="record-rating-bars" aria-label="별점 분포">
                  {(["5", "4", "3", "2", "1"] as const).map((tier) => {
                    const count = data.ratingCounts[tier] ?? 0;
                    const pct =
                      data.reviewCount > 0 ? Math.round((count / data.reviewCount) * 100) : 0;
                    return (
                      <div className="record-rating-bar-row" key={tier}>
                        <span>{tier}점</span>
                        <div className="record-rating-bar-track" aria-hidden="true">
                          <div className="record-rating-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <small>{count}</small>
                      </div>
                    );
                  })}
                </div>
              </div>

              {data.reviews.length > 0 ? (
                <div className="record-review-cards">
                  {data.reviews.map((review) => (
                    <article className="record-review-card" key={review.postId}>
                      <div className="record-review-card__top">
                        <div className="record-review-card__author">
                          <strong>{review.author}</strong>
                          <span
                            className={
                              review.qrVerified
                                ? "record-review-badge record-review-badge--qr"
                                : "record-review-badge"
                            }
                          >
                            <BadgeCheck size={12} aria-hidden="true" />
                            {review.qrVerified ? "QR 참가 인증" : "참가 확정 후기"}
                          </span>
                        </div>
                        <span
                          className="record-review-card__stars"
                          aria-label={`별점 ${review.rating}점`}
                        >
                          {[1, 2, 3, 4, 5].map((value) => (
                            <Star
                              key={value}
                              size={13}
                              fill={value <= review.rating ? "currentColor" : "none"}
                              aria-hidden="true"
                            />
                          ))}
                          <strong>{review.rating}.0</strong>
                        </span>
                      </div>
                      <Link href={review.href} className="record-review-card__title">
                        <h3>{review.title}</h3>
                      </Link>
                      <p className="record-review-card__body">
                        {review.body.slice(0, 220)}
                        {review.body.length > 220 ? "…" : ""}
                      </p>
                      <div className="record-review-card__foot">
                        <small>{recordDate(review.createdAt)}</small>
                        <Link href={review.href}>
                          전체 후기 보기 <ArrowRight size={13} aria-hidden="true" />
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="record-note">
                  아직 등록된 참가 후기가 없어요. 참여하신 분이라면 첫 별점과 후기를 남겨보세요!
                </p>
              )}
            </section>
            <ReviewComposeModal
              open={reviewModalOpen}
              onOpenChange={setReviewModalOpen}
              target={{
                postId: data.postId,
                title: data.title,
                category: data.category,
                meetupType: data.meetupType,
                endsAt: data.endsAt,
                location: data.location,
                hostNickname: data.hostNickname,
              }}
              onSubmitted={() => setReloadKey((prev) => prev + 1)}
            />
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
