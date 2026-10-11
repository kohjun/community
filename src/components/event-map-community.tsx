"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  BookOpenCheck,
  Check,
  ChevronDown,
  ChevronLeft,
  List,
  Map as MapIcon,
  ExternalLink,
  Heart,
  LoaderCircle,
  LocateFixed,
  MapPin,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
  Zap,
} from "lucide-react";
import { CATEGORIES } from "@/domain/categories";
import type { CommunityVenue, EventMapSnapshot, MapEvent } from "@/domain/event-map";
import { appRequest, RequestError } from "@/lib/api-client";
import { useLocation } from "@/lib/use-location";
import {
  geocodeAddress,
  type GeocodedAddress,
  type MapBounds,
  type MapPin as LocationPin,
  type MapPoint,
} from "@/lib/naver-maps";
import { ParticipationShell } from "./participation-shell";
import { SafetyActions } from "./safety-actions";
import { NaverEventMap } from "./naver-event-map";
import { EventLocationField } from "./event-location-field";
import { MemberAvatar } from "./member-avatar";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

const categories = CATEGORIES.filter((category) => category.sortOrder < 9);
type Mode = "all" | "place" | "event";
type Draft = {
  name: string;
  address: string;
  description: string;
  categorySlug: string;
  spaceType: "indoor" | "outdoor" | "mixed";
  isFree: boolean;
  feeNote: string;
  capacity: string;
  tags: string;
  websiteUrl: string;
  point: MapPoint | null;
};
const emptyDraft = (): Draft => ({
  name: "",
  address: "",
  description: "",
  categorySlug: "party",
  spaceType: "mixed",
  isFree: true,
  feeNote: "",
  capacity: "",
  tags: "",
  websiteUrl: "",
  point: null,
});
const categoryName = (slug: string) =>
  categories.find((category) => category.slug === slug)?.name ?? "이벤트";
const spaceNames = { indoor: "실내", outdoor: "야외", mixed: "실내 · 야외" };
function eventDate(value: string | null) {
  if (!value) return "일정 미정";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
function removeVenue(snapshot: EventMapSnapshot, id: string): EventMapSnapshot {
  return {
    ...snapshot,
    venues: snapshot.venues.filter((venue) => venue.id !== id),
    totalVenues: Math.max(
      0,
      snapshot.totalVenues - Number(snapshot.venues.some((venue) => venue.id === id)),
    ),
  };
}
function mapLink(name: string, address: string) {
  return "https://map.naver.com/p/search/" + encodeURIComponent(name + " " + address);
}
function publicWebsite(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function failureMessage(error: unknown, fallback: string) {
  if (error instanceof RequestError && error.code === "UNAUTHENTICATED")
    return "로그인이 만료됐어요. 다시 로그인한 후 이용해주세요.";
  return error instanceof Error ? error.message : fallback;
}

function focusPanel(element: HTMLElement | null, scroll: boolean) {
  if (!element) return;
  element.focus({ preventScroll: true });
  if (!scroll) return;
  const headerHeight =
    document.querySelector(".service-header")?.getBoundingClientRect().height ?? 128;
  const top = window.scrollY + element.getBoundingClientRect().top - headerHeight - 12;
  window.scrollTo({
    top: Math.max(0, top),
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
  });
}

export function EventMapCommunity({
  initial,
  canWrite,
  clientId,
  initialFocus = null,
  initialSelection = null,
}: {
  initial: EventMapSnapshot;
  canWrite: boolean;
  clientId: string | null;
  initialFocus?: MapPoint | null;
  initialSelection?: string | null;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [mode, setMode] = useState<Mode>("all");
  const [mobileView, setMobileView] = useState<"map" | "list">("map");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [freeOnly, setFreeOnly] = useState(false);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [focusPoint, setFocusPoint] = useState<MapPoint | null>(initialFocus);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelection);
  const [detail, setDetail] = useState<CommunityVenue | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [mutating, setMutating] = useState(false);
  const [notice, setNotice] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<CommunityVenue | null>(null);
  const [picking, setPicking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressError, setAddressError] = useState("");
  const [addressResults, setAddressResults] = useState<GeocodedAddress[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const [detailReload, setDetailReload] = useState(0);
  const mounted = useRef(false);
  const loadSequence = useRef(0);
  const detailSequence = useRef(0);
  const addressSequence = useRef(0);
  const mutationSequence = useRef(0);
  const locationSequence = useRef(0);
  const loadingRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const addressRequest = useRef<AbortController | null>(null);
  const mutationRequest = useRef<AbortController | null>(null);
  const mutationBusy = useRef(false);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const mapElement = useRef<HTMLDivElement>(null);
  const detailElement = useRef<HTMLElement>(null);
  const resultsElement = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const { requestLocation, cancelLocation } = location;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++loadSequence.current;
      ++detailSequence.current;
      ++addressSequence.current;
      ++mutationSequence.current;
      ++locationSequence.current;
      loadingRequest.current?.abort();
      detailRequest.current?.abort();
      addressRequest.current?.abort();
      mutationRequest.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (submitting || mutating) return;
    const token = ++loadSequence.current;
    loadingRequest.current?.abort();
    const controller = new AbortController();
    loadingRequest.current = controller;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setLoadError("");
      const params = new URLSearchParams({ mode, category });
      if (query.trim()) params.set("q", query.trim());
      if (freeOnly) params.set("freeOnly", "true");
      if (bounds) Object.entries(bounds).forEach(([key, value]) => params.set(key, String(value)));
      try {
        const next = await appRequest<EventMapSnapshot>(
          `/api/event-map?${params}`,
          "GET",
          undefined,
          controller.signal,
        );
        if (!mounted.current || token !== loadSequence.current || controller.signal.aborted) return;
        setSnapshot(next);
        setDetail((previous) =>
          previous ? (next.venues.find((venue) => venue.id === previous.id) ?? previous) : null,
        );
      } catch (error) {
        if (mounted.current && token === loadSequence.current && !controller.signal.aborted)
          setLoadError(failureMessage(error, "장소를 불러오지 못했어요."));
      } finally {
        if (mounted.current && token === loadSequence.current) setLoading(false);
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [mode, query, category, freeOnly, bounds, reload, submitting, mutating]);
  useEffect(() => {
    const token = ++detailSequence.current;
    detailRequest.current?.abort();
    setDetailError("");
    setMutationError("");
    if (!selectedId?.startsWith("place:")) return;
    const controller = new AbortController();
    detailRequest.current = controller;
    void appRequest<CommunityVenue>(
      `/api/event-map/${selectedId.slice(6)}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((value) => {
        if (mounted.current && token === detailSequence.current && !controller.signal.aborted)
          setDetail(value);
      })
      .catch((error) => {
        if (!mounted.current || token !== detailSequence.current || controller.signal.aborted)
          return;
        setDetailError(failureMessage(error, "장소의 최신 정보를 확인하지 못했어요."));
        if (error instanceof RequestError && error.code === "NOT_FOUND") {
          setDetail(null);
          setSnapshot((previous) => removeVenue(previous, selectedId.slice(6)));
          refresh();
        }
      });
    return () => controller.abort();
  }, [selectedId, detailReload]);

  useEffect(() => {
    if (picking) mapElement.current?.scrollIntoView({ block: "center", behavior: "instant" });
  }, [picking]);
  const venueId = selectedId?.startsWith("place:") ? selectedId.slice(6) : null;
  const selectedVenue = venueId
    ? detail?.id === venueId
      ? detail
      : snapshot.venues.find((venue) => venue.id === venueId)
    : null;
  const selectedEvent = selectedId?.startsWith("event:")
    ? snapshot.events.find((event) => event.id === selectedId.slice(6))
    : null;
  const showDetail = Boolean(selectedVenue || selectedEvent || detailError) && !picking;
  useEffect(() => {
    if (!showDetail || picking || formOpen || deleteOpen) return;
    const mobile = window.matchMedia("(max-width: 720px)").matches;
    if (mobile && mobileView !== "map") return;
    const frame = requestAnimationFrame(() => focusPanel(detailElement.current, mobile));
    return () => cancelAnimationFrame(frame);
  }, [showDetail, selectedId, mobileView, picking, formOpen, deleteOpen]);
  const pins = useMemo<LocationPin[]>(
    () => [
      ...snapshot.venues.map((venue) => ({
        id: `place:${venue.id}`,
        kind: "place" as const,
        latitude: venue.latitude,
        longitude: venue.longitude,
        label: venue.name,
        categoryLabel: categoryName(venue.categorySlug),
      })),
      ...(selectedVenue && !snapshot.venues.some((venue) => venue.id === selectedVenue.id)
        ? [
            {
              id: "place:" + selectedVenue.id,
              kind: "place" as const,
              latitude: selectedVenue.latitude,
              longitude: selectedVenue.longitude,
              label: selectedVenue.name,
              categoryLabel: categoryName(selectedVenue.categorySlug),
            },
          ]
        : []),
      ...snapshot.events.map((event) => ({
        id: `event:${event.id}`,
        kind: event.meetupType,
        latitude: event.latitude,
        longitude: event.longitude,
        label: event.title,
        categoryLabel: categoryName(event.categorySlug),
      })),
    ],
    [snapshot, selectedVenue],
  );
  const onBoundsChange = useCallback(
    (next: MapBounds) =>
      setBounds((previous) =>
        previous &&
        Object.keys(next).every(
          (key) =>
            Math.abs(next[key as keyof MapBounds] - previous[key as keyof MapBounds]) < 0.00001,
        )
          ? previous
          : next,
      ),
    [],
  );
  function select(id: string, point?: MapPoint) {
    if (picking || mutationBusy.current) return;
    ++locationSequence.current;
    cancelLocation();
    setSelectedId(id);
    setMobileView("map");
    setMutationError("");
    if (point) {
      setFocusPoint({ ...point });
    }
  }
  function invalidateAddress() {
    ++addressSequence.current;
    addressRequest.current?.abort();
    setAddressLoading(false);
    setAddressError("");
    setAddressResults([]);
  }
  function begin(venue?: CommunityVenue) {
    if (mutationBusy.current) return;
    invalidateAddress();
    setFormError("");
    setPicking(false);
    setEditing(venue ?? null);
    setDraft(
      venue
        ? {
            name: venue.name,
            address: venue.address,
            description: venue.description,
            categorySlug: venue.categorySlug,
            spaceType: venue.spaceType,
            isFree: venue.isFree,
            feeNote: venue.feeNote,
            capacity: venue.capacity === null ? "" : String(venue.capacity),
            tags: venue.tags.join(", "),
            websiteUrl: venue.websiteUrl ?? "",
            point: { latitude: venue.latitude, longitude: venue.longitude },
          }
        : emptyDraft(),
    );
    setFormOpen(true);
  }
  async function searchAddress() {
    const address = draft.address.trim();
    if (!address || addressLoading) return;
    invalidateAddress();
    const token = ++addressSequence.current;
    const controller = new AbortController();
    addressRequest.current = controller;
    setAddressLoading(true);
    try {
      const values = await geocodeAddress(address, { signal: controller.signal });
      if (!mounted.current || token !== addressSequence.current || controller.signal.aborted)
        return;
      setAddressResults(values);
      if (!values.length)
        setAddressError(
          "일치하는 주소가 없어요. 도로명·지번 주소로 검색하거나 지도 위치를 직접 선택해주세요.",
        );
    } catch (error) {
      if (mounted.current && token === addressSequence.current && !controller.signal.aborted)
        setAddressError(
          failureMessage(error, "주소를 찾지 못했어요. 좌표를 직접 입력할 수 있어요."),
        );
    } finally {
      if (mounted.current && token === addressSequence.current) setAddressLoading(false);
    }
  }
  function refresh() {
    ++loadSequence.current;
    loadingRequest.current?.abort();
    setReload((value) => value + 1);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationBusy.current) return;
    if (!draft.point) {
      setFormError("주소 검색 결과를 선택하거나 지도 위치·좌표를 설정해주세요.");
      return;
    }
    const tags = [
      ...new Set(
        draft.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ];
    if (tags.length > 5) {
      setFormError("태그는 최대 5개까지 입력할 수 있어요.");
      return;
    }
    if (tags.some((tag) => tag.length > 24)) {
      setFormError("각 태그는 24자 이내로 입력해주세요.");
      return;
    }
    const capacity = draft.capacity.trim() ? Number(draft.capacity) : null;
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 5000)) {
      setFormError("수용 인원은 1~5,000명 사이로 입력하거나 비워주세요.");
      return;
    }
    if (draft.websiteUrl.trim() && !publicWebsite(draft.websiteUrl.trim())) {
      setFormError("관련 링크는 http 또는 https로 시작하는 주소를 입력해주세요.");
      return;
    }
    const token = ++mutationSequence.current;
    const controller = new AbortController();
    mutationRequest.current = controller;
    mutationBusy.current = true;
    ++loadSequence.current;
    loadingRequest.current?.abort();
    setLoading(false);
    setSubmitting(true);
    setFormError("");
    invalidateAddress();
    ++detailSequence.current;
    detailRequest.current?.abort();
    try {
      const next = await appRequest<CommunityVenue>(
        editing ? `/api/event-map/${editing.id}` : "/api/event-map",
        editing ? "PUT" : "POST",
        {
          name: draft.name.trim(),
          address: draft.address.trim(),
          description: draft.description.trim(),
          categorySlug: draft.categorySlug,
          spaceType: draft.spaceType,
          isFree: draft.isFree,
          feeNote: draft.feeNote.trim(),
          capacity,
          tags,
          websiteUrl: draft.websiteUrl.trim() || null,
          latitude: draft.point.latitude,
          longitude: draft.point.longitude,
          ...(editing ? { version: editing.version } : {}),
        },
        controller.signal,
      );
      if (!mounted.current || token !== mutationSequence.current || controller.signal.aborted)
        return;
      setDetail(next);
      setSelectedId(`place:${next.id}`);
      setMobileView("map");
      setFocusPoint({ latitude: next.latitude, longitude: next.longitude });
      setFormOpen(false);
      setNotice(editing ? "장소 정보를 수정했어요." : "우리의 이벤트 맵에 새 장소를 추가했어요.");
      refresh();
    } catch (error) {
      if (mounted.current && token === mutationSequence.current && !controller.signal.aborted) {
        setFormError(failureMessage(error, "장소를 저장하지 못했어요."));
        if (error instanceof RequestError && error.code === "NOT_FOUND" && editing) {
          setDetail(null);
          setSnapshot((previous) => removeVenue(previous, editing.id));
          setDetailError("이 장소는 이미 삭제되어 더 이상 지도에 표시되지 않아요.");
          refresh();
        }
        if (error instanceof RequestError && error.code === "CONFLICT") {
          refresh();
          setDetailReload((value) => value + 1);
          setFormError(
            "장소 정보가 다른 화면에서 변경됐어요. 이 창을 닫고 최신 정보에서 다시 수정해주세요.",
          );
        }
      }
    } finally {
      mutationBusy.current = false;
      if (mounted.current && token === mutationSequence.current) setSubmitting(false);
    }
  }
  async function mutateVenue(action: "recommend" | "delete") {
    const venue = selectedVenue;
    if (!venue || mutationBusy.current) return;
    const token = ++mutationSequence.current;
    const controller = new AbortController();
    mutationRequest.current = controller;
    mutationBusy.current = true;
    ++detailSequence.current;
    detailRequest.current?.abort();
    ++loadSequence.current;
    loadingRequest.current?.abort();
    setLoading(false);
    setMutating(true);
    setMutationError("");
    try {
      if (action === "delete") {
        await appRequest<{ id: string }>(
          `/api/event-map/${venue.id}`,
          "DELETE",
          { version: venue.version },
          controller.signal,
        );
        if (!mounted.current || token !== mutationSequence.current || controller.signal.aborted)
          return;
        setSelectedId(null);
        setDetail(null);
        setSnapshot((previous) => removeVenue(previous, venue.id));
        setDeleteOpen(false);
        setNotice("장소를 삭제했어요.");
      } else {
        const next = await appRequest<CommunityVenue>(
          `/api/event-map/${venue.id}/recommend`,
          "POST",
          { liked: !venue.recommended },
          controller.signal,
        );
        if (!mounted.current || token !== mutationSequence.current || controller.signal.aborted)
          return;
        setDetail(next);
        setSnapshot((previous) => ({
          ...previous,
          venues: previous.venues.map((item) => (item.id === next.id ? next : item)),
        }));
      }
      refresh();
    } catch (error) {
      if (mounted.current && token === mutationSequence.current && !controller.signal.aborted) {
        setMutationError(failureMessage(error, "요청을 처리하지 못했어요."));
        if (error instanceof RequestError && error.code === "NOT_FOUND") {
          setDetail(null);
          setSnapshot((previous) => removeVenue(previous, venue.id));
          refresh();
        }
        if (error instanceof RequestError && error.code === "CONFLICT") {
          refresh();
          setDetailReload((value) => value + 1);
        }
      }
    } finally {
      mutationBusy.current = false;
      if (mounted.current && token === mutationSequence.current) setMutating(false);
    }
  }
  async function locate() {
    const token = ++locationSequence.current;
    const point = await requestLocation();
    if (point && mounted.current && token === locationSequence.current) setFocusPoint(point);
  }
  const website = publicWebsite(selectedVenue?.websiteUrl ?? null);

  return (
    <ParticipationShell>
      <section className="event-map-page">
        <header className="event-map-heading">
          <div>
            <span>
              <MapPin size={15} /> 함께 만드는 이벤트 맵
            </span>
            <h1>다음 만남은, 여기서.</h1>
            <p>좋은 장소를 함께 모으고, 그곳에서 새로운 모임을 시작해요.</p>
          </div>
          {canWrite ? (
            <button className="emap-primary" onClick={() => begin()}>
              <Plus size={17} /> 장소 등록
            </button>
          ) : (
            <Link className="emap-primary" href="/login?returnTo=%2Fmap">
              <Plus size={17} /> 장소 등록
            </Link>
          )}
        </header>
        {notice && (
          <div className="emap-notice" role="status">
            <Check size={16} />
            {notice}
            <button aria-label="안내 닫기" onClick={() => setNotice("")}>
              <X size={16} />
            </button>
          </div>
        )}
        <div
          className={`emap-workspace${showDetail ? " has-detail" : ""}`}
          data-mobile-view={mobileView}
        >
          <div className="emap-toolbar">
            <div className="emap-search" role="search">
              <Search size={18} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                maxLength={100}
                placeholder="장소명 또는 주소 검색"
                aria-label="장소명 또는 주소 검색"
              />
              {loading && <LoaderCircle size={16} className="emap-spin" aria-label="검색 중" />}
              {query && (
                <button onClick={() => setQuery("")} aria-label="검색어 지우기">
                  <X size={16} />
                </button>
              )}
            </div>
            <div className="emap-modes" aria-label="지도에 표시할 항목">
              {(
                [
                  { value: "all", label: "전체" },
                  { value: "place", label: "추천 장소" },
                  { value: "event", label: "모집 · 번개" },
                ] as const
              ).map((item) => (
                <button
                  key={item.value}
                  aria-pressed={mode === item.value}
                  className={mode === item.value ? "is-active" : ""}
                  onClick={() => setMode(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="emap-filters">
              <label>
                <SlidersHorizontal size={15} />
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  aria-label="관심 카테고리"
                >
                  <option value="all">모든 취향</option>
                  {categories.map((item) => (
                    <option key={item.slug} value={item.slug}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </label>
              <button
                aria-pressed={freeOnly}
                className={freeOnly ? "is-active" : ""}
                onClick={() => setFreeOnly((value) => !value)}
              >
                {freeOnly && <Check size={13} />} 무료만
              </button>
            </div>
            {(loadError || snapshot.truncated) && (
              <div className="emap-toolbar-feedback">
                {loadError && (
                  <div className="emap-error" role="alert">
                    {loadError}
                    <button onClick={refresh}>다시 불러오기</button>
                  </div>
                )}
                {snapshot.truncated && (
                  <p className="emap-truncated">
                    표시할 항목이 많아요. 지도를 확대하거나 취향을 선택해 더 좁혀보세요.
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="emap-mobile-view" role="group" aria-label="이벤트 맵 보기 방식">
            <button
              type="button"
              className={mobileView === "map" ? "is-active" : ""}
              aria-pressed={mobileView === "map"}
              aria-controls="emap-map-panel"
              onClick={() => setMobileView("map")}
            >
              <MapIcon size={17} /> 지도 보기
            </button>
            <button
              type="button"
              className={mobileView === "list" ? "is-active" : ""}
              aria-pressed={mobileView === "list"}
              aria-controls="emap-list-panel"
              disabled={picking}
              onClick={() => setMobileView("list")}
            >
              <List size={17} /> 목록 보기
              <span>{snapshot.totalVenues + snapshot.totalEvents}</span>
            </button>
          </div>
          <aside className="emap-sidebar" id="emap-list-panel" aria-label="지도 장소 목록">
            <div className="emap-result-heading">
              <span>{bounds ? "지금 지도 안에서" : "등록된 장소와 이벤트"}</span>
              <strong>{snapshot.totalVenues + snapshot.totalEvents}개</strong>
              {loading && <LoaderCircle size={14} className="emap-spin" aria-label="불러오는 중" />}
            </div>
            <div className="emap-results" ref={resultsElement} tabIndex={-1} aria-busy={loading}>
              {snapshot.venues.map((venue) => (
                <button
                  className={`emap-result ${selectedId === `place:${venue.id}` ? "is-selected" : ""}`}
                  key={`place:${venue.id}`}
                  onClick={() => select(`place:${venue.id}`, venue)}
                  aria-pressed={selectedId === `place:${venue.id}`}
                >
                  <span className="emap-result-kind">
                    <MapPin size={13} /> 추천 장소 <span>{categoryName(venue.categorySlug)}</span>
                  </span>
                  <strong>{venue.name}</strong>
                  <span className="emap-result-address">{venue.address}</span>
                  <span className="emap-result-meta">
                    <span>
                      {venue.isFree ? "무료" : "유료"} · {spaceNames[venue.spaceType]}
                    </span>
                    <span>
                      <Heart size={12} /> {venue.recommendations}
                    </span>
                  </span>
                </button>
              ))}
              {snapshot.events.map((event) => (
                <button
                  className={`emap-result ${selectedId === `event:${event.id}` ? "is-selected" : ""}`}
                  key={`event:${event.id}`}
                  onClick={() => select(`event:${event.id}`, event)}
                  aria-pressed={selectedId === `event:${event.id}`}
                >
                  <span className="emap-result-kind">
                    {event.meetupType === "lightning" ? (
                      <Zap size={13} />
                    ) : (
                      <CalendarDays size={13} />
                    )}{" "}
                    {event.meetupType === "lightning" ? "번개" : "모집"}
                    <span>{categoryName(event.categorySlug)}</span>
                  </span>
                  <strong>{event.title}</strong>
                  <span className="emap-result-address">{event.location}</span>
                  <span className="emap-result-meta">
                    <span>
                      {event.amountKRW ? `${event.amountKRW.toLocaleString("ko-KR")}원` : "무료"}
                    </span>
                    <span className={!event.open ? "emap-muted" : ""}>
                      {event.open ? "모집 중" : "모집 마감"}
                    </span>
                  </span>
                </button>
              ))}
              {!loading && !snapshot.venues.length && !snapshot.events.length && !loadError && (
                <div className="emap-empty">
                  <MapPin size={25} />
                  <strong>아직 표시할 장소가 없어요</strong>
                  <p>
                    지도를 움직이거나 검색 조건을 바꿔보세요.
                    <br />
                    좋은 장소를 알고 있다면 첫 번째로 등록해요.
                  </p>
                  {canWrite && (
                    <button onClick={() => begin()}>
                      장소 등록하기 <Plus size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>
            <p className="emap-community-note">누구나 좋은 장소를 더해 완성하는 우리의 지도</p>
          </aside>
          <div className="emap-map-column" id="emap-map-panel">
            <div className="emap-map-wrap" ref={mapElement}>
              <NaverEventMap
                clientId={clientId}
                pins={pins}
                selectedId={selectedId}
                onSelect={(id) => select(id)}
                onBoundsChange={onBoundsChange}
                focusPoint={focusPoint}
                picking={picking}
                onPick={(point) => {
                  if (!picking || mutationBusy.current) return;
                  ++locationSequence.current;
                  cancelLocation();
                  invalidateAddress();
                  setDraft((previous) => ({ ...previous, point }));
                  setPicking(false);
                  setFormOpen(true);
                }}
              />
              {!picking && (
                <button
                  className="emap-locate"
                  aria-label="현재 위치 주변으로 지도 이동"
                  title="현재 위치 주변으로 지도 이동"
                  onClick={() => void locate()}
                  disabled={location.status === "loading" || !clientId}
                >
                  {location.status === "loading" ? (
                    <LoaderCircle size={19} className="emap-spin" />
                  ) : (
                    <LocateFixed size={19} />
                  )}
                </button>
              )}
              {picking && (
                <div className="emap-picking" role="status">
                  <MapPin size={17} />
                  <span>장소가 있는 지점을 눌러주세요</span>
                  <button
                    onClick={() => {
                      setPicking(false);
                      setFormOpen(true);
                    }}
                  >
                    취소
                  </button>
                </div>
              )}
              <div className="emap-legend" aria-label="지도 마커 범례">
                <span>
                  <i />
                  추천 장소
                </span>
                <span>
                  <i className="event" />
                  이벤트
                </span>
                <span>
                  <i className="lightning" />
                  번개
                </span>
              </div>
            </div>
            {location.error && (
              <p className="emap-error" role="alert">
                {location.error}
              </p>
            )}
          </div>
          {showDetail && (
            <section
              className="emap-detail"
              ref={detailElement}
              tabIndex={-1}
              aria-label={selectedEvent ? "선택한 이벤트 상세" : "선택한 장소 상세"}
            >
              <div className="emap-detail-topline">
                <button
                  type="button"
                  className="emap-detail-close"
                  aria-label="상세 닫고 목록으로 돌아가기"
                  disabled={mutating}
                  onClick={() => {
                    setSelectedId(null);
                    setDetail(null);
                    setDetailError("");
                    setMutationError("");
                    setMobileView("list");
                    requestAnimationFrame(() =>
                      focusPanel(
                        resultsElement.current,
                        window.matchMedia("(max-width: 720px)").matches,
                      ),
                    );
                  }}
                >
                  <ChevronLeft size={18} /> 목록으로
                </button>
                <span>{selectedEvent ? "이벤트 정보" : "장소 정보"}</span>
              </div>
              {selectedVenue && (
                <>
                  <div className="emap-detail-kicker">
                    <MapPin size={14} /> 추천 장소 · {categoryName(selectedVenue.categorySlug)}
                    <span>{selectedVenue.isFree ? "무료" : "유료"}</span>
                  </div>
                  {!snapshot.venues.some((venue) => venue.id === selectedVenue.id) && (
                    <p className="emap-selected-note">
                      선택한 장소는 검색 조건과 달라도 지도에 유지돼요.
                    </p>
                  )}
                  <h2>{selectedVenue.name}</h2>
                  <p className="emap-detail-address">
                    {selectedVenue.address}
                    <a
                      href={mapLink(selectedVenue.name, selectedVenue.address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="네이버 지도에서 장소 확인"
                    >
                      네이버 지도 <ArrowUpRight size={13} />
                    </a>
                  </p>
                  <p className="emap-detail-description">{selectedVenue.description}</p>
                  <div className="emap-detail-meta">
                    <span>{spaceNames[selectedVenue.spaceType]}</span>
                    {selectedVenue.capacity !== null && (
                      <span>
                        <Users size={14} /> 최대 {selectedVenue.capacity}명
                      </span>
                    )}
                    {selectedVenue.feeNote && <span>{selectedVenue.feeNote}</span>}
                  </div>
                  {!!selectedVenue.tags.length && (
                    <div className="emap-tags">
                      {selectedVenue.tags.map((tag) => (
                        <span key={tag}>#{tag}</span>
                      ))}
                    </div>
                  )}
                  <div className="emap-contributor">
                    {selectedVenue.contributor ? (
                      <>
                        <MemberAvatar
                          nickname={selectedVenue.contributor.nickname}
                          avatar={selectedVenue.contributor.avatar}
                          photoSrc={null}
                        />
                        <Link href={`/players/${selectedVenue.contributor.publicId}`}>
                          {selectedVenue.contributor.nickname}
                        </Link>
                        <span>님이 공유한 장소</span>
                      </>
                    ) : (
                      <span>커뮤니티가 함께 공유한 장소</span>
                    )}
                    {selectedVenue.isOwner && (
                      <div>
                        <button onClick={() => begin(selectedVenue)} disabled={mutating}>
                          <Pencil size={13} /> 수정
                        </button>
                        <button
                          onClick={() => {
                            setMutationError("");
                            setDeleteOpen(true);
                          }}
                          disabled={mutating}
                        >
                          <Trash2 size={13} /> 삭제
                        </button>
                      </div>
                    )}
                  </div>
                  <SafetyActions
                    targetType="venue"
                    targetId={selectedVenue.id}
                    isMine={selectedVenue.isOwner}
                    canAct={canWrite}
                    onBlocked={() => {
                      setSelectedId(null);
                      setDetail(null);
                      refresh();
                    }}
                  />
                  <div className="emap-detail-actions">
                    <Link
                      className="emap-primary"
                      href={`/lightning?venue=${selectedVenue.id}&open=1`}
                    >
                      <Zap size={16} /> 여기서 번개 열기
                    </Link>
                    <Link className="emap-secondary" href={`/places/${selectedVenue.id}`}>
                      <BookOpenCheck size={16} /> 이 장소의 행사 기록
                    </Link>
                    {canWrite ? (
                      <button
                        className={`emap-secondary emap-recommend ${selectedVenue.recommended ? "is-active" : ""}`}
                        onClick={() => void mutateVenue("recommend")}
                        disabled={mutating}
                      >
                        <Heart
                          size={16}
                          fill={selectedVenue.recommended ? "currentColor" : "none"}
                        />{" "}
                        추천 {selectedVenue.recommendations}
                      </button>
                    ) : (
                      <Link className="emap-secondary" href="/login?returnTo=%2Fmap">
                        <Heart size={16} /> 추천 {selectedVenue.recommendations}
                      </Link>
                    )}
                    {website && (
                      <a
                        className="emap-website"
                        href={website}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        관련 링크 <ExternalLink size={13} />
                      </a>
                    )}
                  </div>
                </>
              )}
              {selectedEvent && <MapEventDetail event={selectedEvent} />}
              {(detailError || mutationError) && (
                <p className="emap-error" role="alert">
                  {mutationError || detailError}
                </p>
              )}
            </section>
          )}
        </div>
      </section>
      <Dialog
        open={formOpen}
        onOpenChange={(next) => {
          if (submitting) return;
          if (!next) invalidateAddress();
          setFormOpen(next);
        }}
      >
        <DialogContent
          className="emap-form-dialog"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            formHeading.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (submitting) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (submitting) event.preventDefault();
          }}
        >
          <div className="emap-form-header">
            <span>
              <MapPin size={16} /> 우리의 지도에 한 곳 더
            </span>
            <DialogTitle ref={formHeading} tabIndex={-1}>
              {editing ? "장소 정보 수정" : "이벤트 장소 공유하기"}
            </DialogTitle>
            <DialogDescription>
              함께 놀기 좋은 장소를 알려주세요. 공개된 장소와 정확한 위치를 등록해요.
            </DialogDescription>
          </div>
          <form className="emap-form" onSubmit={submit}>
            <fieldset disabled={submitting}>
              <label>
                장소 이름 <span>필수</span>
                <input
                  value={draft.name}
                  maxLength={80}
                  minLength={2}
                  required
                  placeholder="예: 연남동 보드게임 라운지"
                  onChange={(event) =>
                    setDraft((previous) => ({ ...previous, name: event.target.value }))
                  }
                />
              </label>
              <label>
                주소 <span>필수</span>
                <div className="emap-address-input">
                  <input
                    value={draft.address}
                    required
                    minLength={5}
                    maxLength={200}
                    placeholder="도로명 또는 지번 주소"
                    onChange={(event) => {
                      invalidateAddress();
                      setDraft((previous) => ({
                        ...previous,
                        address: event.target.value,
                        point: null,
                      }));
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void searchAddress()}
                    disabled={!clientId || !draft.address.trim() || addressLoading}
                  >
                    {addressLoading ? (
                      <LoaderCircle size={16} className="emap-spin" />
                    ) : (
                      <Search size={16} />
                    )}{" "}
                    주소 찾기
                  </button>
                </div>
              </label>
              {addressError && (
                <p className="emap-error" role="alert">
                  {addressError}
                </p>
              )}
              {!!addressResults.length && (
                <div className="emap-address-results" aria-label="주소 검색 결과">
                  {addressResults.map((result, index) => (
                    <button
                      key={`${result.latitude}:${result.longitude}:${index}`}
                      type="button"
                      onClick={() => {
                        invalidateAddress();
                        setDraft((previous) => ({
                          ...previous,
                          address: result.address,
                          point: { latitude: result.latitude, longitude: result.longitude },
                        }));
                      }}
                    >
                      <MapPin size={15} />
                      <span>
                        <strong>{result.roadAddress || result.address}</strong>
                        {result.jibunAddress && result.jibunAddress !== result.roadAddress && (
                          <small>{result.jibunAddress}</small>
                        )}
                      </span>
                      <Check size={15} />
                    </button>
                  ))}
                </div>
              )}
              <div className="emap-form-location">
                <div>
                  <strong>
                    지도 위치 <span>필수</span>
                  </strong>
                  <button
                    type="button"
                    disabled={!clientId}
                    onClick={() => {
                      invalidateAddress();
                      ++locationSequence.current;
                      cancelLocation();
                      setMobileView("map");
                      setPicking(true);
                      setFormOpen(false);
                      if (draft.point) setFocusPoint({ ...draft.point });
                    }}
                  >
                    <MapPin size={14} /> 지도에서 선택
                  </button>
                </div>
                <EventLocationField
                  value={draft.point}
                  onChange={(point) => {
                    invalidateAddress();
                    setDraft((previous) => ({ ...previous, point }));
                  }}
                  disabled={submitting}
                  allowSharedPlaces={false}
                  idPrefix="emap-venue"
                />
                {!clientId && (
                  <p className="emap-muted">
                    지도를 준비하는 동안에도 좌표 직접 입력으로 장소를 등록할 수 있어요.
                  </p>
                )}
              </div>
              <div className="emap-form-grid">
                <label>
                  어떤 이벤트에 좋나요?
                  <select
                    value={draft.categorySlug}
                    onChange={(event) =>
                      setDraft((previous) => ({ ...previous, categorySlug: event.target.value }))
                    }
                  >
                    {categories.map((item) => (
                      <option key={item.slug} value={item.slug}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  공간 유형
                  <select
                    value={draft.spaceType}
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        spaceType: event.target.value as Draft["spaceType"],
                      }))
                    }
                  >
                    <option value="indoor">실내</option>
                    <option value="outdoor">야외</option>
                    <option value="mixed">실내 · 야외</option>
                  </select>
                </label>
              </div>
              <div className="emap-cost-toggle">
                <span>이용 비용</span>
                <div>
                  <button
                    type="button"
                    aria-pressed={draft.isFree}
                    className={draft.isFree ? "is-active" : ""}
                    onClick={() => setDraft((previous) => ({ ...previous, isFree: true }))}
                  >
                    무료
                  </button>
                  <button
                    type="button"
                    aria-pressed={!draft.isFree}
                    className={!draft.isFree ? "is-active" : ""}
                    onClick={() => setDraft((previous) => ({ ...previous, isFree: false }))}
                  >
                    유료
                  </button>
                </div>
              </div>
              <label>
                비용 안내 <span>선택</span>
                <input
                  value={draft.feeNote}
                  maxLength={160}
                  placeholder="예: 1인 2시간 8,000원 · 음료 별도"
                  onChange={(event) =>
                    setDraft((previous) => ({ ...previous, feeNote: event.target.value }))
                  }
                />
              </label>
              <label>
                장소 소개 <span>필수</span>
                <textarea
                  value={draft.description}
                  required
                  rows={4}
                  minLength={10}
                  maxLength={2000}
                  placeholder="어떤 게임이나 모임에 어울리나요? 예약 방법과 이용할 때 알아둘 점도 함께 알려주세요."
                  onChange={(event) =>
                    setDraft((previous) => ({ ...previous, description: event.target.value }))
                  }
                />
              </label>
              <div className="emap-form-grid">
                <label>
                  수용 인원 <span>선택</span>
                  <input
                    type="number"
                    min={1}
                    max={5000}
                    inputMode="numeric"
                    value={draft.capacity}
                    placeholder="예: 12"
                    onChange={(event) =>
                      setDraft((previous) => ({ ...previous, capacity: event.target.value }))
                    }
                  />
                </label>
                <label>
                  태그 <span>최대 5개</span>
                  <input
                    value={draft.tags}
                    maxLength={130}
                    placeholder="보드게임, 대관, 주차가능"
                    onChange={(event) =>
                      setDraft((previous) => ({ ...previous, tags: event.target.value }))
                    }
                  />
                </label>
              </div>
              <label>
                관련 링크 <span>선택</span>
                <input
                  type="url"
                  value={draft.websiteUrl}
                  maxLength={1000}
                  placeholder="https://"
                  onChange={(event) =>
                    setDraft((previous) => ({ ...previous, websiteUrl: event.target.value }))
                  }
                />
              </label>
            </fieldset>
            {formError && (
              <p className="emap-error" role="alert">
                {formError}
              </p>
            )}
            <div className="emap-form-footer">
              <span>등록한 장소는 누구나 볼 수 있어요.</span>
              <button className="emap-primary" type="submit" disabled={submitting}>
                {submitting ? <LoaderCircle size={16} className="emap-spin" /> : <Plus size={16} />}
                {submitting ? "저장 중…" : editing ? "수정 완료" : "장소 등록"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={deleteOpen}
        onOpenChange={(next) => {
          if (!mutating) setDeleteOpen(next);
        }}
      >
        <DialogContent
          className="emap-delete-dialog"
          onEscapeKeyDown={(event) => {
            if (mutating) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (mutating) event.preventDefault();
          }}
        >
          <DialogTitle>이 장소를 삭제할까요?</DialogTitle>
          <DialogDescription>
            이벤트 맵에서 장소와 추천 기록이 삭제돼요. 이미 열린 모임은 유지돼요.
          </DialogDescription>
          {mutationError && (
            <p className="emap-error" role="alert">
              {mutationError}
            </p>
          )}
          <div>
            <button
              className="emap-secondary"
              onClick={() => setDeleteOpen(false)}
              disabled={mutating}
            >
              취소
            </button>
            <button
              className="emap-primary"
              onClick={() => void mutateVenue("delete")}
              disabled={mutating}
            >
              {mutating ? "삭제 중…" : "장소 삭제"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </ParticipationShell>
  );
}

function MapEventDetail({ event }: { event: MapEvent }) {
  return (
    <>
      <div className="emap-detail-kicker">
        {event.meetupType === "lightning" ? <Zap size={14} /> : <CalendarDays size={14} />}
        {event.meetupType === "lightning" ? "번개 모임" : "이벤트 모집"} ·{" "}
        {categoryName(event.categorySlug)}
        <span>{event.open ? "모집 중" : "모집 마감"}</span>
      </div>
      <h2>{event.title}</h2>
      <p className="emap-detail-address">
        {event.location}
        <a href={mapLink(event.title, event.location)} target="_blank" rel="noopener noreferrer">
          네이버 지도 <ArrowUpRight size={13} />
        </a>
      </p>
      <div className="emap-detail-meta">
        <span>
          <CalendarDays size={14} />
          {eventDate(event.startsAt)}
        </span>
        <span>
          <Users size={14} />
          정원 {event.capacity}명
        </span>
        <span>
          {event.amountKRW ? `${event.amountKRW.toLocaleString("ko-KR")}원` : "무료 참가"}
        </span>
      </div>
      <div className="emap-detail-actions">
        <Link className="emap-primary" href={`/events/${event.id}`}>
          이벤트 자세히 보기 <ArrowUpRight size={16} />
        </Link>
      </div>
    </>
  );
}
