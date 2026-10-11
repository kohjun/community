"use client";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  Check,
  Clock3,
  LoaderCircle,
  MapPin,
  Minus,
  Plus,
  Search,
  X,
  Users,
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
import { koreanDateTimeInput, koreanDateTimeISO } from "@/domain/refund";
import { meetupVenueLabel, type MeetupVenuePreset } from "@/domain/venue-meetup";
import { useReadPosts } from "@/lib/use-read-posts";
import { appRequest } from "@/lib/api-client";
import type { VenuePoint } from "@/domain/discovery";
import { applicationUrlSchema } from "@/domain/application-url";
import { EventLocationField } from "./event-location-field";
import { ParticipationShell } from "./participation-shell";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

const topics = CATEGORIES.filter((category) => category.sortOrder < 9);
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
    [startsAt, setStartsAt] = useState(
      initialOpen ? koreanDateTimeInput(new Date(Date.now() + 3600000).toISOString()) : "",
    ),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [capacity, setCapacity] = useState("6"),
    [applicationMode, setApplicationMode] = useState<"direct" | "external">("direct"),
    [applicationUrl, setApplicationUrl] = useState(""),
    [priceKRW, setPriceKRW] = useState("0"),
    [created, setCreated] = useState<CreatedMeetup | null>(null);
  const readPosts = useReadPosts();
  const loadVersion = useRef(0);
  const dialogHeading = useRef<HTMLHeadingElement>(null);
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
    setTitle("");
    setDescription("");
    setCapacity("6");
    setApplicationMode("direct");
    setApplicationUrl("");
    setPriceKRW("0");
    setDraftActivity(category);
    setDraftTheme(
      initialVenue?.categorySlug ?? (category ? lightningCategory(category).topic : "party"),
    );
    setDraftTags([]);
    setCustomTag("");
    setTagError("");
    setStartsAt(koreanDateTimeInput(new Date(Date.now() + 3600000).toISOString()));
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
    const external = applicationMode === "external";
    const parsedUrl = external ? applicationUrlSchema.safeParse(applicationUrl) : null;
    if (parsedUrl && !parsedUrl.success) {
      setFormError(parsedUrl.error.issues[0]?.message ?? "외부 신청 링크를 확인해주세요.");
      return;
    }
    const amount = external ? Number(priceKRW) : 0;
    if (!Number.isInteger(amount) || amount < 0 || amount > 10000000) {
      setFormError("참가비는 0원부터 10,000,000원까지 정수로 입력해주세요.");
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
    const endsAt = new Date(
      Date.parse(start) + Number(values.get("duration")) * 60000,
    ).toISOString();
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
        priceKRW: amount,
        applicationUrl: parsedUrl?.success ? parsedUrl.data : null,
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
  return (
    <ParticipationShell>
      <section className="lightning-hero">
        <div>
          <span className="lightning-kicker">
            <Zap size={15} /> 가볍게 모이는 오늘의 번개
          </span>
          <h1>지금, 같이 놀 사람?</h1>
          <p>복잡한 준비 없이 취향 맞는 사람들과 작은 모임을 열어보세요.</p>
        </div>
        {canWrite ? (
          <button className="participation-primary" onClick={begin}>
            <Plus size={18} /> 번개 열기
          </button>
        ) : (
          <Link className="participation-primary" href="/login">
            로그인하고 번개 열기
          </Link>
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
          <Zap size={17} /> 무료 직접 참가 · 외부 신청 연동
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
                : "슬리퍼에서 신청하면 참가자가 공지방에 자동 초대돼요. 참가 현황과 공지를 관리해보세요."}
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
      <div className="lightning-grid" aria-busy={loading}>
        {feed.posts.map((post) => (
          <article className="lightning-card" key={post.id}>
            <Link className="lightning-card-main" href={`/events/${post.id}`}>
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
              <p className="lightning-excerpt">{post.excerpt}</p>
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
              <span>{post.author}</span>
              <small>
                {post.eventCancelledAt
                  ? "행사 취소 · 취소 안내 보기"
                  : post.eventAvailable === false
                    ? "모집 마감"
                    : post.applicationUrl
                      ? "외부 신청 · 승인 후 참가"
                      : "무료 참가"}{" "}
                · {post.time}
              </small>
            </div>
            {post.applicationUrl && (
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
            {post.venueLatitude != null && post.venueLongitude != null && (
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
        ))}
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
                <Zap size={13} /> {applicationMode === "external" ? "외부 신청 연동" : "무료 참가"}
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
              <fieldset className="lightning-form-fields" disabled={submitting}>
                <section
                  className="lightning-form-section"
                  aria-labelledby="lightning-about-heading"
                >
                  <div className="lightning-section-heading">
                    <span className="lightning-section-number" aria-hidden="true">
                      01
                    </span>
                    <h3 id="lightning-about-heading">함께할 활동을 소개해주세요</h3>
                  </div>
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
                      placeholder="예: 오늘 저녁, 신서유기 게임 같이해요"
                    />
                  </label>
                  <LightningCategoryPicker
                    value={draftActivity}
                    onChange={selectActivity}
                    variant="form"
                    disabled={submitting}
                  />
                  <div className="lightning-activity-tags">
                    <div className="lightning-field-heading">
                      <span>
                        세부 활동 태그 <small>선택</small>
                      </span>
                      <small>{draftTags.length}/5</small>
                    </div>
                    <p>활동 이름을 붙이면 같은 취향의 사람들이 더 쉽게 찾아요.</p>
                    {selectedActivity && (
                      <div className="lightning-tag-suggestions" aria-label="추천 세부 활동">
                        {selectedActivity.examples.map((item) => (
                          <button
                            key={item}
                            type="button"
                            aria-pressed={draftTags.includes(item)}
                            onClick={() => toggleTag(item)}
                            disabled={
                              submitting || (!draftTags.includes(item) && draftTags.length >= 5)
                            }
                          >
                            #{item}
                            {draftTags.includes(item) && <Check size={12} />}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="lightning-custom-tag">
                      <input
                        aria-label="직접 입력할 활동 태그"
                        maxLength={24}
                        placeholder="예: 공포 방탈출"
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
                    {!!draftTags.length && (
                      <div className="lightning-selected-tags" aria-label="선택한 활동 태그">
                        {draftTags.map((item) => (
                          <button
                            key={item}
                            type="button"
                            onClick={() => toggleTag(item)}
                            aria-label={`${item} 태그 삭제`}
                            disabled={submitting}
                          >
                            #{item}
                            <X size={12} />
                          </button>
                        ))}
                      </div>
                    )}
                    {tagError && (
                      <p className="lightning-tag-error" role="alert">
                        {tagError}
                      </p>
                    )}
                  </div>
                  <details className="lightning-theme-details">
                    <summary>
                      커뮤니티 주제 · {topics.find((item) => item.slug === draftTheme)?.name}
                    </summary>
                    <label className="lightning-field">
                      <span>홈에서도 어떤 주제로 보여줄까요?</span>
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
                        활동 카테고리에 맞춰 기본 설정했어요. 모임 성격에 맞게 바꿀 수 있어요.
                      </small>
                    </label>
                  </details>
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
                      rows={3}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="함께할 활동, 만나는 방법, 준비물을 편하게 적어주세요."
                      aria-describedby="lightning-description-hint"
                    />
                    <small id="lightning-description-hint">
                      10자 이상이면 충분해요. 처음 오는 사람도 알 수 있게 소개해주세요.
                    </small>
                  </label>
                </section>
                <section
                  className="lightning-form-section"
                  aria-labelledby="lightning-schedule-heading"
                >
                  <div className="lightning-section-heading">
                    <span className="lightning-section-number" aria-hidden="true">
                      02
                    </span>
                    <h3 id="lightning-schedule-heading">언제, 몇 명이 모일까요?</h3>
                  </div>
                  <div className="lightning-form-row lightning-schedule-row">
                    <label className="lightning-field">
                      <span className="lightning-field-heading">
                        <span>
                          시작 일시{" "}
                          <span className="lightning-required" aria-hidden="true">
                            *
                          </span>
                        </span>
                        <small>한국시간</small>
                      </span>
                      <input
                        name="startsAt"
                        type="datetime-local"
                        required
                        step={60}
                        value={startsAt}
                        onChange={(event) => setStartsAt(event.target.value)}
                        aria-describedby="lightning-time-hint"
                      />
                    </label>
                    <label className="lightning-field">
                      <span className="lightning-field-heading">
                        <span>진행 시간</span>
                        <Clock3 size={14} aria-hidden="true" />
                      </span>
                      <select name="duration" defaultValue="120">
                        <option value="30">30분</option>
                        <option value="60">1시간</option>
                        <option value="90">1시간 30분</option>
                        <option value="120">2시간</option>
                        <option value="180">3시간</option>
                      </select>
                    </label>
                  </div>
                  <div className="lightning-quick-time">
                    <button
                      type="button"
                      onClick={() =>
                        setStartsAt(
                          koreanDateTimeInput(new Date(Date.now() + 3600000).toISOString()),
                        )
                      }
                    >
                      1시간 뒤
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setStartsAt(
                          koreanDateTimeInput(new Date(Date.now() + 86400000).toISOString()),
                        )
                      }
                    >
                      내일 이 시간
                    </button>
                    <small id="lightning-time-hint">지금부터 7일 이내로 정해주세요.</small>
                  </div>
                  <div className="lightning-capacity-row">
                    <div>
                      <label htmlFor="lightning-capacity">
                        모집 인원{" "}
                        <span className="lightning-required" aria-hidden="true">
                          *
                        </span>
                      </label>
                      <p id="lightning-capacity-hint">주최자를 제외한 참가자 자리 수예요.</p>
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
                <section
                  className="lightning-form-section"
                  aria-labelledby="lightning-place-heading"
                >
                  <div className="lightning-section-heading">
                    <span className="lightning-section-number" aria-hidden="true">
                      03
                    </span>
                    <h3 id="lightning-place-heading">만날 장소를 알려주세요</h3>
                  </div>
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
                  <label className="lightning-field">
                    <span>
                      모이는 장소{" "}
                      <span className="lightning-required" aria-hidden="true">
                        *
                      </span>
                    </span>
                    <input
                      name="location"
                      required
                      minLength={2}
                      maxLength={120}
                      value={location}
                      onChange={(event) => {
                        setLocation(event.target.value);
                        setVenue((before) =>
                          before
                            ? { latitude: before.latitude, longitude: before.longitude }
                            : null,
                        );
                      }}
                      placeholder="예: 서울숲역 3번 출구 앞"
                    />
                  </label>
                  <div className="lightning-venue-card">
                    <div className="lightning-venue-heading">
                      <span>
                        <MapPin size={16} /> 모임 장소의 지도 위치
                      </span>
                      <span
                        className={
                          venue ? "lightning-venue-status is-set" : "lightning-venue-status"
                        }
                      >
                        {venue ? (
                          <>
                            <Check size={12} /> 설정 완료
                          </>
                        ) : (
                          "필수 설정"
                        )}
                      </span>
                    </div>
                    <EventLocationField
                      value={venue}
                      onChange={setVenue}
                      onPlaceSelected={(place) => setLocation(meetupVenueLabel(place))}
                      disabled={submitting}
                      purpose="venue"
                      idPrefix="lightning-venue"
                    />
                  </div>
                </section>
                <section
                  className="lightning-form-section"
                  aria-labelledby="lightning-application-heading"
                >
                  <div className="lightning-section-heading">
                    <span className="lightning-section-number" aria-hidden="true">
                      04
                    </span>
                    <h3 id="lightning-application-heading">참가 신청은 어디에서 받을까요?</h3>
                  </div>
                  <label className="lightning-field">
                    <span>신청 방식</span>
                    <select
                      name="applicationMode"
                      value={applicationMode}
                      onChange={(event) =>
                        setApplicationMode(event.target.value as "direct" | "external")
                      }
                    >
                      <option value="direct">슬리퍼에서 무료 참가 신청</option>
                      <option value="external">외부 플랫폼에서 신청·결제</option>
                    </select>
                  </label>
                  {applicationMode === "external" ? (
                    <>
                      <label className="lightning-field">
                        <span>
                          외부 신청·결제 링크 <span className="lightning-required">*</span>
                        </span>
                        <input
                          name="applicationUrl"
                          type="url"
                          required
                          maxLength={2048}
                          value={applicationUrl}
                          onChange={(event) => setApplicationUrl(event.target.value)}
                          placeholder="https://…"
                          aria-describedby="lightning-external-hint"
                        />
                      </label>
                      <label className="lightning-field">
                        <span>외부 플랫폼 참가비 · 원</span>
                        <input
                          name="priceKRW"
                          type="number"
                          required
                          min={0}
                          max={10000000}
                          step={1}
                          value={priceKRW}
                          onChange={(event) => setPriceKRW(event.target.value)}
                        />
                        <small>
                          외부 플랫폼의 실제 참가비와 같게 입력해주세요. 무료 신청은 0원이에요.
                        </small>
                      </label>
                      <small id="lightning-external-hint">
                        신청·결제는 외부 플랫폼에서 진행해요. 참가자가 슬리퍼에서 신청 번호를
                        제출하면 담당자가 확인 후 승인하거나, 연결된 결제 연동이 확인한 뒤 공지방에
                        초대돼요. 링크를 방문하는 것만으로는 참가가 확정되지 않아요.
                      </small>
                    </>
                  ) : (
                    <small>슬리퍼에서 무료 참가 신청을 완료하면 전용 공지방에 자동 초대돼요.</small>
                  )}
                </section>
              </fieldset>
            </div>
            <footer className="lightning-dialog-footer">
              {formError && (
                <p className="lightning-form-error" role="alert">
                  <AlertCircle size={16} aria-hidden="true" /> {formError}
                </p>
              )}
              <div className="lightning-footer-row">
                <div className="lightning-footer-note">
                  <strong>
                    {applicationMode === "external" ? "외부 참가비" : "참가비"}{" "}
                    <span>
                      {applicationMode === "external"
                        ? Number(priceKRW || 0).toLocaleString("ko-KR")
                        : "0"}
                      원
                    </span>
                  </strong>
                  <p>
                    {applicationMode === "external"
                      ? "외부 신청 확인·승인 후 공지방에 초대돼요."
                      : "신청이 완료되면 공지방에 자동 초대돼요."}
                  </p>
                </div>
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
