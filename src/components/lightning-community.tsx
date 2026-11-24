"use client";
import { LoginLink } from "./login-link";
import { ParticipantGuideEditor } from "./participant-guide";
import type { ParticipantGuide } from "@/domain/participant-guide";
import { useAdSenseContentGuard } from "./adsense-provider";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  Check,
  LoaderCircle,
  MapPin,
  Minus,
  Plus,
  Search,
  X,
  Users,
  UserRound,
  Zap,
} from "lucide-react";
import { CATEGORIES, type CategorySlug } from "@/domain/categories";
import type { CommunityFeed } from "@/domain/community";
import {
  lightningCategory,
  POPULAR_LIGHTNING_TAGS,
  type LightningCategorySlug,
} from "@/domain/lightning-categories";
import { LightningCategoryPicker, LightningCategoryIcon } from "./lightning-category-picker";
import { koreanDateTimeISO } from "@/domain/refund";
import {
  addMinutes,
  koreanClock,
  roundedStart,
  scheduleText,
  upcomingDays,
} from "@/domain/recruit-schedule";
import { meetupVenueLabel, type MeetupVenuePreset } from "@/domain/venue-meetup";
import { postPath } from "@/domain/post-sharing";
import { isJanuaryRecruitmentSample } from "@/demo/january-recruitments";
import { useReadPosts } from "@/lib/use-read-posts";
import { appRequest } from "@/lib/api-client";
import type { VenuePoint } from "@/domain/discovery";
import { EventLocationField } from "./event-location-field";
import { ParticipationShell } from "./participation-shell";
import { PostAuthorName } from "./post-author-name";
import { ExampleGallery } from "./example-gallery";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import rf from "./recruit-form.module.css";

const topics = CATEGORIES.filter((category) => category.sortOrder < 9);
const QUICK_TIMES = [
  { time: "12:00", label: "점심 12시" },
  { time: "19:00", label: "저녁 7시" },
  { time: "20:00", label: "저녁 8시" },
] as const;
const DURATIONS = [
  { minutes: 30, label: "30분" },
  { minutes: 60, label: "1시간" },
  { minutes: 90, label: "1.5시간" },
  { minutes: 120, label: "2시간" },
  { minutes: 180, label: "3시간" },
] as const;
const LIGHTNING_INTRO_TEMPLATE =
  "🙌 이런 분 환영해요: 처음 오셔도 괜찮아요\n📍 만나는 방법: \n🎒 준비물: 없어요\n💸 비용: 각자 계산 (현장 정산)";
interface CreatedMeetup {
  postId: string;
  externalUrl: string | null;
  applicationUrl: string;
  managementUrl: string;
}
export function LightningCommunity({
  initial,
  canWrite,
  initialVenue = null,
  initialOpen = false,
  venueUnavailable = false,
  initialCategory = "",
  initialTag = "",
  initialSearch = "",
}: {
  initial: CommunityFeed;
  canWrite: boolean;
  initialVenue?: MeetupVenuePreset | null;
  initialOpen?: boolean;
  venueUnavailable?: boolean;
  initialCategory?: LightningCategorySlug | "";
  initialTag?: string;
  initialSearch?: string;
}) {
  const [feed, setFeed] = useState(initial),
    [category, setCategory] = useState<LightningCategorySlug | "">(initialCategory),
    [tag, setTag] = useState(initialTag),
    [search, setSearch] = useState(initialSearch),
    [searchDraft, setSearchDraft] = useState(initialSearch),
    [draftActivity, setDraftActivity] = useState<LightningCategorySlug | "">(initialCategory),
    [draftTheme, setDraftTheme] = useState<CategorySlug>(
      initialVenue?.categorySlug ??
        (initialCategory ? lightningCategory(initialCategory).topic : "party"),
    ),
    [draftTags, setDraftTags] = useState<string[]>([]),
    [customTag, setCustomTag] = useState(""),
    [tagError, setTagError] = useState(""),
    [loading, setLoading] = useState(false),
    [loadError, setLoadError] = useState(""),
    [open, setOpen] = useState(initialOpen),
    [submitting, setSubmitting] = useState(false),
    [formError, setFormError] = useState(""),
    [venue, setVenue] = useState<VenuePoint | null>(
      initialVenue
        ? {
            latitude: initialVenue.latitude,
            longitude: initialVenue.longitude,
            communityVenueId: initialVenue.id,
            communityVenueVersion: initialVenue.version,
          }
        : null,
    ),
    [location, setLocation] = useState(initialVenue ? meetupVenueLabel(initialVenue) : ""),
    [startsAt, setStartsAt] = useState(initialOpen ? roundedStart(Date.now()) : ""),
    [duration, setDuration] = useState(120),
    [formNow, setFormNow] = useState(() => Date.now()),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [capacity, setCapacity] = useState("6"),
    [created, setCreated] = useState<CreatedMeetup | null>(null);
  const [participantGuide, setParticipantGuide] = useState<ParticipantGuide | null>(null);
  const advertisingBlocked = open || feed.posts.length === 0;
  useAdSenseContentGuard(advertisingBlocked);
  const readPosts = useReadPosts();
  const loadVersion = useRef(0);
  const dialogHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!initialOpen) return;
    // Opening is a one-time action: reloading or returning to this page should not reopen the form.
    const url = new URL(window.location.href);
    url.searchParams.delete("open");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [initialOpen]);
  async function load(
    nextCategory: LightningCategorySlug | "",
    nextTag = tag,
    nextSearch = search,
    more = false,
  ) {
    const version = ++loadVersion.current;
    setLoading(true);
    setLoadError("");
    const params = new URLSearchParams({ eventOnly: "true", meetupType: "lightning" });
    if (nextCategory) params.set("activityCategory", nextCategory);
    if (nextTag) params.set("tag", nextTag);
    if (nextSearch.trim()) params.set("search", nextSearch.trim());
    if (more && feed.nextCursor) params.set("cursor", feed.nextCursor);
    try {
      const next = await appRequest<CommunityFeed>(`/api/community?${params}`);
      if (version !== loadVersion.current) return;
      setFeed((previous) => (more ? { ...next, posts: [...previous.posts, ...next.posts] } : next));
      setCategory(nextCategory);
      setTag(nextTag);
      setSearch(nextSearch.trim());
    } catch (error) {
      if (version === loadVersion.current)
        setLoadError(error instanceof Error ? error.message : "번개를 불러오지 못했어요.");
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }
  function begin() {
    setFormError("");
    setVenue(
      initialVenue
        ? {
            latitude: initialVenue.latitude,
            longitude: initialVenue.longitude,
            communityVenueId: initialVenue.id,
            communityVenueVersion: initialVenue.version,
          }
        : null,
    );
    setLocation(initialVenue ? meetupVenueLabel(initialVenue) : "");
    setParticipantGuide(null);
    setTitle("");
    setDescription("");
    setCapacity("6");
    setDraftActivity(category);
    setDraftTheme(
      initialVenue?.categorySlug ?? (category ? lightningCategory(category).topic : "party"),
    );
    setDraftTags([]);
    setCustomTag("");
    setTagError("");
    setFormNow(Date.now());
    setStartsAt(roundedStart(Date.now()));
    setDuration(120);
    setOpen(true);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (!draftActivity) {
      setFormError("함께할 활동 카테고리를 선택해주세요.");
      return;
    }
    if (customTag.trim()) {
      setTagError("입력한 태그를 추가하거나 지운 후 번개를 열어주세요.");
      return;
    }
    if (!venue) {
      setFormError("모이는 장소의 지도 위치를 설정해주세요. 가까운 번개를 찾는 데 사용해요.");
      return;
    }
    const values = new FormData(event.currentTarget);
    const start = koreanDateTimeISO(startsAt);
    if (
      !start ||
      Date.parse(start) <= Date.now() ||
      Date.parse(start) > Date.now() + 7 * 86400000
    ) {
      setFormError("시작 시간은 지금 이후부터 7일 이내로 설정해주세요.");
      return;
    }
    const endsAt = new Date(Date.parse(start) + duration * 60000).toISOString();
    setSubmitting(true);
    setFormError("");
    try {
      const result = await appRequest<CreatedMeetup>("/api/lightning", "POST", {
        categorySlug: draftTheme,
        activityCategory: draftActivity,
        activityTags: draftTags,
        title: values.get("title"),
        description: values.get("description"),
        location: values.get("location"),
        venue,
        startsAt: start,
        endsAt,
        capacity: Number(values.get("capacity")),
        priceKRW: 0,
        applicationUrl: null,
        participantGuide,
      });
      setCreated(result);
      setOpen(false);
      void load(category);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "번개를 열지 못했어요.");
    } finally {
      setSubmitting(false);
    }
  }
  function selectActivity(value: LightningCategorySlug | "") {
    setDraftActivity(value);
    if (value) setDraftTheme(lightningCategory(value).topic);
    setTagError("");
  }
  function toggleTag(value: string) {
    setTagError("");
    if (draftTags.includes(value)) setDraftTags(draftTags.filter((item) => item !== value));
    else if (draftTags.length < 5) setDraftTags([...draftTags, value]);
    else setTagError("세부 활동 태그는 최대 5개까지 선택할 수 있어요.");
  }
  function addCustomTag() {
    const value = customTag.trim().replace(/^#+/, "").trim();
    if (!value || value.length > 24) {
      setTagError("태그는 1–24자로 입력해주세요.");
      return;
    }
    if (draftTags.includes(value)) {
      setCustomTag("");
      setTagError("");
      return;
    }
    if (draftTags.length >= 5) {
      setTagError("태그는 최대 5개까지 추가할 수 있어요.");
      return;
    }
    setDraftTags([...draftTags, value]);
    setCustomTag("");
    setTagError("");
  }
  const suggestions = category ? lightningCategory(category).examples : POPULAR_LIGHTNING_TAGS;
  const browseTags = [...new Set([...suggestions, ...(tag ? [tag] : [])])];
  const selectedActivity = draftActivity ? lightningCategory(draftActivity) : null;
  const days = upcomingDays(formNow, 7);
  const startDay = startsAt.slice(0, 10),
    startTime = startsAt.slice(11, 16);
  const finish = startTime ? addMinutes(startTime, duration) : null;
  const whenText =
    startDay && startTime && finish
      ? `${scheduleText(startDay, "")} ${koreanClock(startTime)} ~ ${finish.nextDay ? "다음 날 " : ""}${koreanClock(finish.time)}`
      : "";
  // Checked while choosing, so a past time is flagged before submitting.
  const startPassed = !!startDay && !!startTime && Date.parse(`${startsAt}:00+09:00`) <= Date.now();
  const dayWord =
    startDay === days[0]!.date ? "오늘" : startDay === days[1]!.date ? "내일" : "이번 주";
  const checklist = [
    { label: "활동", done: !!draftActivity },
    { label: "제목", done: title.trim().length >= 2 },
    { label: "소개", done: description.trim().length >= 10 },
    { label: "시간", done: !!startDay && !!startTime && !startPassed },
    { label: "장소", done: !!venue },
  ];
  return (
    <ParticipationShell wide advertising={!advertisingBlocked}>
      <section className="lightning-hero">
        <div>
          <span className="lightning-kicker">
            <Zap size={15} /> 가볍게 모이는 오늘의 번개
          </span>
          <h1>지금, 같이 놀 사람?</h1>
          <p>복잡한 준비 없이 취향 맞는 사람들과 작은 모임을 열어보세요.</p>
          <div className="maturity-actions">
            <Link href="/discover/saved">조건 저장·모집 알림</Link>
            <Link href="/ideas">원하는 모임 제안</Link>
          </div>
        </div>
        {canWrite ? (
          <button className="participation-primary" onClick={begin}>
            <Plus size={18} /> 번개 열기
          </button>
        ) : (
          <LoginLink className="participation-primary">로그인하고 번개 열기</LoginLink>
        )}
      </section>
      <div className="lightning-intro">
        <span>
          <Users size={17} /> 2–12명 소규모 모임
        </span>
        <span>
          <CalendarDays size={17} /> 일정과 장소를 한 번에
        </span>
        <span>
          <Zap size={17} /> 담당자 승인 후 참가 확정
        </span>
        <Link href="/map">
          이벤트 맵에서 장소 찾기 <ArrowUpRight size={15} />
        </Link>
      </div>
      {venueUnavailable && (
        <p className="participation-error" role="status">
          선택한 장소가 삭제되었거나 사용할 수 없어요.{" "}
          <Link href="/map">이벤트 맵에서 다른 장소 찾기</Link>
        </p>
      )}
      {created && (
        <div className="lightning-success" role="status">
          <Check size={20} />
          <div>
            <strong>번개가 열렸어요!</strong>
            <p>
              {created.externalUrl
                ? "외부 플랫폼에서 신청한 참가자의 신청 번호·결제 내역을 확인하고 승인하면 공지방에 초대돼요."
                : "참가 요청을 확인하고 승인하면 공지방에 초대돼요. 비용은 모임 현장에서 함께 정산해요."}
            </p>
          </div>
          <Link className="participation-secondary" href={created.applicationUrl}>
            모임 보기
          </Link>
          <Link className="participation-primary" href={created.managementUrl}>
            참가자 관리
          </Link>
        </div>
      )}
      <div className="lightning-list-heading">
        <h2>함께할 번개를 찾아요</h2>
        <small>최신 등록순</small>
      </div>
      <section className="lightning-discovery-panel" aria-label="번개 활동 검색">
        <LightningCategoryPicker
          value={category}
          onChange={(value) => void load(value, "", search)}
          disabled={loading}
        />
        <div className="lightning-browse-tags" aria-label="세부 활동 필터">
          <span>{category ? "이런 활동은 어때요?" : "많이 찾는 활동"}</span>
          {browseTags.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={tag === item}
              className={tag === item ? "is-selected" : ""}
              disabled={loading}
              onClick={() => void load(category, tag === item ? "" : item, search)}
            >
              #{item}
            </button>
          ))}
        </div>
        <form
          className="lightning-search-form"
          onSubmit={(event) => {
            event.preventDefault();
            void load(category, tag, searchDraft);
          }}
        >
          <Search size={18} aria-hidden="true" />
          <input
            aria-label="번개 제목·소개·활동 태그 검색"
            placeholder="활동 이름이나 번개 제목으로 검색해보세요"
            maxLength={100}
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            disabled={loading}
          />
          <button type="submit" disabled={loading}>
            검색
          </button>
        </form>
        {(category || tag || search) && (
          <div className="lightning-active-filters" aria-label="적용된 검색 조건">
            <span>
              {category ? lightningCategory(category).name : "모든 활동"}
              {tag ? ` · #${tag}` : ""}
              {search ? ` · “${search}”` : ""}
            </span>
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setSearchDraft("");
                void load("", "", "");
              }}
            >
              <X size={13} /> 초기화
            </button>
          </div>
        )}
      </section>
      {loadError && (
        <p className="participation-error" role="alert">
          {loadError}
        </p>
      )}
      {!loading && !category && !tag && !search && <ExampleGallery kind="lightning" mobileSwipe />}
      <div className="lightning-grid" aria-busy={loading}>
        {feed.posts.map((post) => {
          const sample = isJanuaryRecruitmentSample(post);
          return (
            <article className="lightning-card" key={post.id}>
              <Link className="lightning-card-main" href={postPath(post.id)}>
                <div className="lightning-card-top">
                  <span>
                    <LightningCategoryIcon slug={post.activityCategory} size={15} />
                    {lightningCategory(post.activityCategory).name}
                  </span>
                  <ArrowUpRight size={17} />
                </div>
                <h3 className={readPosts.includes(post.id) ? "title-is-read" : undefined}>
                  {post.title}
                  {readPosts.includes(post.id) && <span className="sr-only"> (읽은 글)</span>}
                </h3>
                {!!post.tags.length && (
                  <div className="lightning-card-tags">
                    {post.tags.map((item) => (
                      <span key={item}>#{item}</span>
                    ))}
                  </div>
                )}
                <div className="lightning-card-meta">
                  {post.location && (
                    <span>
                      <MapPin size={15} /> {post.location}
                    </span>
                  )}
                  {post.eventDate && (
                    <span>
                      <CalendarDays size={15} /> {post.eventDate}
                    </span>
                  )}
                </div>
              </Link>
              <div className="lightning-card-bottom">
                <PostAuthorName post={post} icon={<UserRound size={13} aria-hidden="true" />} />
                <small>
                  {sample
                    ? "1월 모집 샘플"
                    : post.eventCancelledAt
                      ? "행사 취소 · 취소 안내 보기"
                      : post.eventAvailable === false
                        ? "모집 마감"
                        : post.applicationUrl
                          ? "외부 신청 · 승인 후 참가"
                          : "담당자 승인 후 참가"}{" "}
                  · {post.time}
                </small>
              </div>
              {!sample && post.applicationUrl && (
                <>
                  <a
                    className="lightning-map-link"
                    href={post.applicationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    외부 플랫폼에서 신청 <ArrowUpRight size={13} />
                  </a>
                  <Link className="lightning-map-link" href={"/events/" + post.id}>
                    결제 후 참가 확인 · 공지방 →
                  </Link>
                </>
              )}
              {!sample && post.venueLatitude != null && post.venueLongitude != null && (
                <a
                  className="lightning-map-link"
                  href={`/map?event=${post.id}&lat=${post.venueLatitude}&lng=${post.venueLongitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${post.title} 행사장 지도 보기 (새 창)`}
                >
                  <MapPin size={13} /> 행사장 지도 보기 <ArrowUpRight size={13} />
                </a>
              )}
            </article>
          );
        })}
      </div>
      {!feed.posts.length && !loading && (
        <section className="participation-card participation-empty lightning-empty">
          <Zap size={34} />
          <h2>
            {category || tag || search ? "조건에 맞는 번개가 아직 없어요" : "첫 번개를 열어볼까요?"}
          </h2>
          <p>
            {category || tag || search
              ? "다른 활동을 고르거나 검색 조건을 초기화해보세요."
              : "가벼운 게임, 산책, 작은 예능 모임부터 시작해보세요."}
          </p>
          {(category || tag || search) && (
            <button
              className="participation-secondary"
              onClick={() => {
                setSearchDraft("");
                void load("", "", "");
              }}
            >
              조건 초기화
            </button>
          )}
          {canWrite && (
            <button className="participation-primary" onClick={begin}>
              번개 열기
            </button>
          )}
        </section>
      )}
      {feed.nextCursor && (
        <button
          className="participation-secondary lightning-more"
          disabled={loading}
          onClick={() => void load(category, tag, search, true)}
        >
          {loading ? "불러오는 중…" : "번개 더 보기"}
        </button>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!submitting) setOpen(value);
        }}
      >
        <DialogContent
          className="lightning-dialog"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            dialogHeading.current?.focus();
          }}
        >
          <header className="lightning-dialog-heading">
            <div className="lightning-dialog-intro">
              <span className="lightning-dialog-icon" aria-hidden="true">
                <Zap size={25} strokeWidth={2} />
              </span>
              <div>
                <span className="lightning-dialog-eyebrow">가볍게 만나고, 즐겁게 놀아요</span>
                <DialogTitle ref={dialogHeading} tabIndex={-1}>
                  어떤 번개를 열까요?
                </DialogTitle>
              </div>
            </div>
            <DialogDescription>
              취향이 맞는 사람들과 함께할 작은 모임을 만들어보세요.
            </DialogDescription>
            <div className="lightning-dialog-badges" aria-label="번개 안내">
              <span>
                <Zap size={13} /> 담당자 승인 후 참가
              </span>
              <span>
                <Users size={13} /> 참가자 2–12명
              </span>
              <span>
                <CalendarDays size={13} /> 7일 이내 모임
              </span>
            </div>
          </header>
          <form className="lightning-form" onSubmit={submit} aria-busy={submitting}>
            <div className="lightning-form-body">
              <fieldset className={`lightning-form-fields ${rf.fields}`} disabled={submitting}>
                <section className={rf.step} aria-labelledby="lightning-activity-heading">
                  <h3 id="lightning-activity-heading" className={rf.stepHead}>
                    <b>1</b>무엇을 하며 놀까요?
                  </h3>
                  <LightningCategoryPicker
                    value={draftActivity}
                    onChange={selectActivity}
                    variant="form"
                    disabled={submitting}
                  />
                  {selectedActivity && (
                    <div className={rf.group}>
                      <span className={rf.groupLabel}>
                        세부 활동 <small>선택 · {draftTags.length}/5</small>
                      </span>
                      <div className={rf.chips} aria-label="추천 세부 활동">
                        {selectedActivity.examples.map((item) => (
                          <button
                            key={item}
                            type="button"
                            className={rf.chip}
                            aria-pressed={draftTags.includes(item)}
                            onClick={() => toggleTag(item)}
                            disabled={
                              submitting || (!draftTags.includes(item) && draftTags.length >= 5)
                            }
                          >
                            #{item}
                            {draftTags.includes(item) && <Check size={12} aria-hidden="true" />}
                          </button>
                        ))}
                        {draftTags
                          .filter((item) => !selectedActivity.examples.includes(item))
                          .map((item) => (
                            <button
                              key={item}
                              type="button"
                              className={rf.chip}
                              aria-pressed
                              aria-label={`${item} 태그 삭제`}
                              onClick={() => toggleTag(item)}
                              disabled={submitting}
                            >
                              #{item}
                              <X size={12} aria-hidden="true" />
                            </button>
                          ))}
                      </div>
                      <div className="lightning-custom-tag">
                        <input
                          aria-label="직접 입력할 활동 태그"
                          maxLength={24}
                          placeholder="찾는 활동이 없으면 직접 입력 (예: 공포 방탈출)"
                          value={customTag}
                          onChange={(event) => setCustomTag(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                              event.preventDefault();
                              addCustomTag();
                            }
                          }}
                          disabled={submitting}
                        />
                        <button
                          type="button"
                          onClick={addCustomTag}
                          disabled={submitting || !customTag.trim()}
                        >
                          추가
                        </button>
                      </div>
                      {tagError && (
                        <p className="lightning-tag-error" role="alert">
                          {tagError}
                        </p>
                      )}
                    </div>
                  )}
                </section>

                <section className={rf.step} aria-labelledby="lightning-about-heading">
                  <h3 id="lightning-about-heading" className={rf.stepHead}>
                    <b>2</b>어떤 모임인지 알려주세요
                  </h3>
                  <label className="lightning-field">
                    <span className="lightning-field-heading">
                      <span>
                        모임 제목{" "}
                        <span className="lightning-required" aria-hidden="true">
                          *
                        </span>
                      </span>
                      <small className="lightning-character-count">{title.length}/80</small>
                    </span>
                    <input
                      name="title"
                      required
                      minLength={2}
                      maxLength={80}
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder={
                        selectedActivity
                          ? `예: ${dayWord} 저녁 ${selectedActivity.examples[0]} 같이해요`
                          : "예: 오늘 저녁, 신서유기 게임 같이해요"
                      }
                    />
                  </label>
                  <label className="lightning-field">
                    <span className="lightning-field-heading">
                      <span>
                        모임 소개{" "}
                        <span className="lightning-required" aria-hidden="true">
                          *
                        </span>
                      </span>
                      <small className="lightning-character-count">
                        {description.length}/3,000
                      </small>
                    </span>
                    <textarea
                      name="description"
                      required
                      minLength={10}
                      maxLength={3000}
                      rows={4}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="무엇을 하는지, 어떤 분과 함께하고 싶은지 편하게 적어주세요."
                      aria-describedby="lightning-description-hint"
                    />
                    <small id="lightning-description-hint">
                      10자 이상이면 충분해요. 처음 오는 사람도 알 수 있게 소개해주세요.
                    </small>
                  </label>
                  <button
                    type="button"
                    className={rf.inlineAction}
                    disabled={submitting || !!description.trim()}
                    onClick={() => setDescription(LIGHTNING_INTRO_TEMPLATE)}
                  >
                    ✍️ 소개 양식 채우기
                  </button>
                </section>

                <section className={rf.step} aria-labelledby="lightning-schedule-heading">
                  <h3 id="lightning-schedule-heading" className={rf.stepHead}>
                    <b>3</b>언제, 몇 명이 만날까요?
                  </h3>
                  <div className={rf.group}>
                    <span className={rf.groupLabel} id="lightning-day-label">
                      <span>
                        날짜{" "}
                        <span className={rf.required} aria-hidden="true">
                          *
                        </span>
                      </span>
                      <small>7일 이내</small>
                    </span>
                    <div className={rf.days} role="group" aria-labelledby="lightning-day-label">
                      {days.map((day) => (
                        <button
                          key={day.date}
                          type="button"
                          className={rf.day}
                          data-weekend={day.weekend}
                          aria-pressed={startDay === day.date}
                          aria-label={`${scheduleText(day.date, "")}${day.label === "오늘" || day.label === "내일" ? ` · ${day.label}` : ""}`}
                          onClick={() => setStartsAt(`${day.date}T${startTime || "19:00"}`)}
                        >
                          <small>{day.weekday}</small>
                          <strong>{day.label}</strong>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className={rf.group}>
                    <span className={rf.groupLabel}>
                      <span>
                        시작 시간{" "}
                        <span className={rf.required} aria-hidden="true">
                          *
                        </span>
                      </span>
                      <small>한국시간</small>
                    </span>
                    <div className={rf.timeRow}>
                      <input
                        type="time"
                        step={600}
                        required
                        className={rf.input}
                        aria-label="시작 시간"
                        value={startTime}
                        onChange={(event) =>
                          setStartsAt(`${startDay || days[0]!.date}T${event.target.value}`)
                        }
                      />
                      {QUICK_TIMES.map(({ time, label }) => (
                        <button
                          key={time}
                          type="button"
                          className={rf.chip}
                          aria-pressed={startTime === time}
                          onClick={() => setStartsAt(`${startDay || days[0]!.date}T${time}`)}
                        >
                          {label}
                        </button>
                      ))}
                      <button
                        type="button"
                        className={rf.chip}
                        onClick={() => setStartsAt(roundedStart(Date.now(), 60, 10))}
                      >
                        1시간 뒤
                      </button>
                    </div>
                  </div>
                  <div className={rf.group}>
                    <span className={rf.groupLabel} id="lightning-duration-label">
                      얼마나 놀까요?
                    </span>
                    <div
                      className={rf.segment}
                      role="group"
                      aria-labelledby="lightning-duration-label"
                    >
                      {DURATIONS.map((option) => (
                        <button
                          key={option.minutes}
                          type="button"
                          aria-pressed={duration === option.minutes}
                          onClick={() => setDuration(option.minutes)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p
                    className={rf.when}
                    data-empty={!whenText}
                    data-warn={startPassed}
                    id="lightning-time-hint"
                    role={startPassed ? "alert" : undefined}
                  >
                    <CalendarDays size={16} aria-hidden="true" />
                    {startPassed
                      ? "이미 지난 시간이에요. 다른 날짜나 시간을 골라주세요."
                      : whenText || "날짜와 시간을 골라주세요 · 지금부터 7일 이내"}
                  </p>
                  <div className="lightning-capacity-row">
                    <div>
                      <label htmlFor="lightning-capacity">
                        모집 인원{" "}
                        <span className="lightning-required" aria-hidden="true">
                          *
                        </span>
                      </label>
                      <p id="lightning-capacity-hint">나를 빼고 함께할 사람 수예요 (2–12명).</p>
                    </div>
                    <div className="lightning-capacity-control">
                      <button
                        type="button"
                        aria-label="모집 인원 1명 줄이기"
                        disabled={Number(capacity) <= 2}
                        onClick={() =>
                          setCapacity(String(Math.max(2, Math.min(12, Number(capacity) - 1))))
                        }
                      >
                        <Minus size={16} />
                      </button>
                      <div>
                        <input
                          id="lightning-capacity"
                          name="capacity"
                          required
                          type="number"
                          min={2}
                          max={12}
                          value={capacity}
                          onChange={(event) => setCapacity(event.target.value)}
                          aria-describedby="lightning-capacity-hint"
                        />
                        <span aria-hidden="true">명</span>
                      </div>
                      <button
                        type="button"
                        aria-label="모집 인원 1명 늘리기"
                        disabled={Number(capacity) >= 12}
                        onClick={() =>
                          setCapacity(String(Math.max(2, Math.min(12, Number(capacity) + 1))))
                        }
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>
                </section>

                <section className={rf.step} aria-labelledby="lightning-place-heading">
                  <h3 id="lightning-place-heading" className={rf.stepHead}>
                    <b>4</b>어디서 만날까요?
                    <small>{venue ? "✓ 설정 완료" : "필수"}</small>
                  </h3>
                  {initialVenue &&
                    venue?.communityVenueId === initialVenue.id &&
                    venue.communityVenueVersion === initialVenue.version && (
                      <p className="lightning-map-preset">
                        <MapPin size={15} />
                        <span>
                          <strong>이벤트 맵에서 가져왔어요</strong>
                          {initialVenue.name} · {initialVenue.address}
                        </span>
                        <Link href="/map">다른 장소 찾기</Link>
                      </p>
                    )}
                  <input type="hidden" name="location" value={location} />
                  <EventLocationField
                    value={venue}
                    address={location}
                    onAddressSelected={setLocation}
                    onChange={setVenue}
                    disabled={submitting}
                    purpose="venue"
                    idPrefix="lightning-venue"
                  />
                </section>

                <details className={rf.more}>
                  <summary>
                    더 자세히 설정하기 <small>선택</small>
                  </summary>
                  <div className={rf.moreBody}>
                    <label className="lightning-field">
                      <span>커뮤니티 주제 · 홈에서 어떤 주제로 보여줄까요?</span>
                      <select
                        name="categorySlug"
                        value={draftTheme}
                        onChange={(event) => setDraftTheme(event.target.value as CategorySlug)}
                      >
                        {topics.map((topic) => (
                          <option key={topic.slug} value={topic.slug}>
                            {topic.name}
                          </option>
                        ))}
                      </select>
                      <small>
                        활동에 맞춰 자동으로 골라뒀어요. 모임 성격에 맞게 바꿀 수 있어요.
                      </small>
                    </label>
                    <ParticipantGuideEditor
                      value={participantGuide}
                      onChange={setParticipantGuide}
                    />
                  </div>
                </details>
              </fieldset>
            </div>
            <footer className="lightning-dialog-footer">
              {formError && (
                <p className="lightning-form-error" role="alert">
                  <AlertCircle size={16} aria-hidden="true" /> {formError}
                </p>
              )}
              <ul className={rf.checklist} aria-label="번개 준비 상태">
                {checklist.map((item) => (
                  <li key={item.label} data-done={item.done}>
                    {item.done ? "✓" : "○"} {item.label}
                  </li>
                ))}
              </ul>
              <div className="lightning-footer-row">
                <div className="lightning-footer-actions">
                  <button
                    type="button"
                    className="lightning-cancel"
                    disabled={submitting}
                    onClick={() => setOpen(false)}
                  >
                    취소
                  </button>
                  <button type="submit" className="lightning-submit" disabled={submitting}>
                    {submitting ? (
                      <LoaderCircle
                        size={17}
                        className="lightning-submit-spinner"
                        aria-hidden="true"
                      />
                    ) : (
                      <Zap size={17} aria-hidden="true" />
                    )}
                    {submitting ? "번개 여는 중…" : "번개 열기"}
                  </button>
                </div>
              </div>
            </footer>
          </form>
        </DialogContent>
      </Dialog>
    </ParticipationShell>
  );
}
