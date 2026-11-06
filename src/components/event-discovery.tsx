"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { CalendarDays, ChevronDown, MapPin, SlidersHorizontal, X, Zap } from "lucide-react";
import { CATEGORIES, type CategorySlug } from "@/domain/categories";
import type { GeoCoordinates } from "@/lib/use-location";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { EventLocationField } from "./event-location-field";

export interface EventDiscoveryFilters {
  eventOnly: boolean;
  meetupType: "all" | "event" | "lightning";
  coordinates: GeoCoordinates | null;
  radiusKm: number | null;
  fromDate: string;
  toDate: string;
  minPriceKRW: number | null;
  maxPriceKRW: number | null;
  availableOnly: boolean;
}

export const DEFAULT_DISCOVERY_FILTERS: EventDiscoveryFilters = {
  eventOnly: false,
  meetupType: "all",
  coordinates: null,
  radiusKm: null,
  fromDate: "",
  toDate: "",
  minPriceKRW: null,
  maxPriceKRW: null,
  availableOnly: false,
};

export function hasDiscoveryFilters(value: EventDiscoveryFilters) {
  return (
    value.eventOnly ||
    value.meetupType !== "all" ||
    value.coordinates !== null ||
    value.radiusKm !== null ||
    !!value.fromDate ||
    !!value.toDate ||
    value.minPriceKRW !== null ||
    value.maxPriceKRW !== null ||
    value.availableOnly
  );
}

function dateRange(week: boolean) {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const fromDate = now.toISOString().slice(0, 10);
  if (week) now.setUTCDate(now.getUTCDate() + ((7 - now.getUTCDay()) % 7));
  return { fromDate, toDate: now.toISOString().slice(0, 10) };
}

export function EventDiscoveryButton({
  onClick,
  active,
}: {
  onClick: () => void;
  active: boolean;
}) {
  return (
    <button
      type="button"
      className={`event-discovery-trigger${active ? " active" : ""}`}
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label="취향 이벤트 찾기"
    >
      <SlidersHorizontal size={16} />
      <span className="event-discovery-full-label">취향 설정</span>
      <span className="event-discovery-short-label" aria-hidden="true">
        취향
      </span>
      {active && <i aria-label="필터 적용됨" />}
    </button>
  );
}

export function EventDiscoveryDialog({
  open,
  onOpenChange,
  value,
  category,
  requireLocation = false,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: EventDiscoveryFilters;
  category: CategorySlug | "all";
  requireLocation?: boolean;
  onApply: (value: EventDiscoveryFilters, category: CategorySlug | "all") => void;
}) {
  const [draft, setDraft] = useState<EventDiscoveryFilters>(value);
  const [draftCategory, setDraftCategory] = useState<CategorySlug | "all">(category);
  const [error, setError] = useState("");
  const [locationFieldVersion, setLocationFieldVersion] = useState(0);
  const [advanced, setAdvanced] = useState(false);
  const [dateChoice, setDateChoice] = useState("언제든");
  const customDate = dateChoice === "직접 선택";
  const [customPrice, setCustomPrice] = useState(false);
  const [otherTopics, setOtherTopics] = useState(false);
  const advancedId = useId();
  const topicsId = useId();
  const today = dateRange(false),
    week = dateRange(true);
  useEffect(() => {
    if (!open) return;
    const today = dateRange(false),
      week = dateRange(true);
    setDraft({ ...value, eventOnly: true });
    setDraftCategory(category);
    setError("");
    setAdvanced(requireLocation);
    setDateChoice(
      !value.fromDate && !value.toDate
        ? "언제든"
        : today.fromDate === value.fromDate && today.toDate === value.toDate
          ? "오늘"
          : week.fromDate === value.fromDate && week.toDate === value.toDate
            ? "이번 주"
            : "직접 선택",
    );
    setCustomPrice(
      ![
        [null, null],
        [0, 0],
        [0, 10000],
        [0, 30000],
      ].some(([min, max]) => value.minPriceKRW === min && value.maxPriceKRW === max),
    );
    setOtherTopics(CATEGORIES.some((item) => item.slug === category && item.sortOrder >= 9));
  }, [open, value, category, requireLocation]);
  const update = (next: Partial<EventDiscoveryFilters>) =>
    setDraft((current) => ({ ...current, ...next }));
  function reset() {
    setLocationFieldVersion((current) => current + 1);
    setDraft({ ...DEFAULT_DISCOVERY_FILTERS, eventOnly: true });
    setDraftCategory("all");
    setDateChoice("언제든");
    setCustomPrice(false);
    setOtherTopics(false);
    setAdvanced(requireLocation);
    setError("");
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if ((requireLocation || draft.radiusKm !== null) && !draft.coordinates) {
      setAdvanced(true);
      setError("거리로 찾으려면 내 주변 위치를 허용하거나 주소·지도에서 위치를 선택해주세요.");
      return;
    }
    if (draft.fromDate && draft.toDate && draft.fromDate > draft.toDate) {
      setDateChoice("직접 선택");
      setError("마지막 날짜는 시작 날짜 이후로 설정해주세요.");
      return;
    }
    if (
      draft.minPriceKRW !== null &&
      draft.maxPriceKRW !== null &&
      draft.minPriceKRW > draft.maxPriceKRW
    ) {
      setAdvanced(true);
      setCustomPrice(true);
      setError("최대 참가비는 최소 참가비 이상이어야 해요.");
      return;
    }
    setError("");
    onApply(draft, draftCategory);
    onOpenChange(false);
  }
  const locationSummary = draft.coordinates
    ? draft.radiusKm !== null
      ? `${draft.radiusKm}km 이내`
      : "검색 위치 선택됨"
    : draft.radiusKm !== null
      ? "검색 위치 선택 필요"
      : "지역 제한 없음";
  const priceSummary =
    draft.minPriceKRW === 0 && draft.maxPriceKRW === 0
      ? "사전 결제 없음"
      : draft.minPriceKRW !== null || draft.maxPriceKRW !== null
        ? `${draft.minPriceKRW?.toLocaleString("ko-KR") ?? "0"} ~ ${draft.maxPriceKRW?.toLocaleString("ko-KR") ?? "제한 없음"}원`
        : "비용 제한 없음";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-discovery-dialog">
        <div className="discovery-dialog-heading">
          <DialogTitle>취향에 맞는 모임 찾기</DialogTitle>
          <DialogDescription>원하는 것만 골라주세요. 나머지는 전체로 찾아드려요.</DialogDescription>
        </div>
        <form className="discovery-form" onSubmit={submit}>
          <div className="discovery-scroll">
            <section className="discovery-section" aria-label="모임 종류">
              <h3>어떤 모임을 찾나요?</h3>
              <div className="discovery-kind-options">
                {(
                  [
                    { value: "all", label: "전체" },
                    { value: "lightning", label: "번개 모임" },
                    { value: "event", label: "일반 이벤트" },
                  ] as const
                ).map((item) => (
                  <button
                    type="button"
                    key={item.value}
                    aria-pressed={draft.meetupType === item.value}
                    className={draft.meetupType === item.value ? "selected" : ""}
                    onClick={() => update({ meetupType: item.value })}
                  >
                    {item.value === "lightning" && <Zap size={14} aria-hidden="true" />}
                    {item.label}
                  </button>
                ))}
              </div>
            </section>
            <section className="discovery-section" aria-label="관심 분야">
              <h3>
                무엇을 하고 싶나요?<small>하나 선택</small>
              </h3>
              <div className="discovery-category-options">
                <button
                  type="button"
                  aria-pressed={draftCategory === "all"}
                  onClick={() => setDraftCategory("all")}
                >
                  전체
                </button>
                {CATEGORIES.filter((item) => item.sortOrder < 9).map((item) => (
                  <button
                    type="button"
                    key={item.slug}
                    aria-pressed={draftCategory === item.slug}
                    onClick={() => setDraftCategory(item.slug)}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="discovery-topics-toggle"
                aria-expanded={otherTopics}
                aria-controls={topicsId}
                onClick={() => setOtherTopics((before) => !before)}
              >
                다른 주제도 보기
                <ChevronDown size={14} aria-hidden="true" />
              </button>
              {otherTopics && (
                <div id={topicsId} className="discovery-category-options discovery-other-topics">
                  {CATEGORIES.filter((item) => item.sortOrder >= 9).map((item) => (
                    <button
                      type="button"
                      key={item.slug}
                      aria-pressed={draftCategory === item.slug}
                      onClick={() => setDraftCategory(item.slug)}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              )}
            </section>
            <section className="discovery-section" aria-label="모임 날짜">
              <h3>
                <CalendarDays size={16} aria-hidden="true" />
                언제 만날까요?
              </h3>
              <div className="discovery-quick-options discovery-date-options">
                {[
                  { label: "언제든", range: { fromDate: "", toDate: "" } },
                  { label: "오늘", range: today },
                  { label: "이번 주", range: week },
                ].map((item) => (
                  <button
                    type="button"
                    key={item.label}
                    aria-pressed={dateChoice === item.label}
                    onClick={() => {
                      update(item.range);
                      setDateChoice(item.label);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={customDate}
                  aria-expanded={customDate}
                  onClick={() => setDateChoice("직접 선택")}
                >
                  직접 선택
                </button>
              </div>
              {customDate && (
                <div className="discovery-two-columns discovery-custom-fields">
                  <label className="discovery-field">
                    시작 날짜
                    <input
                      type="date"
                      value={draft.fromDate}
                      onChange={(e) => update({ fromDate: e.target.value })}
                    />
                  </label>
                  <label className="discovery-field">
                    마지막 날짜
                    <input
                      type="date"
                      value={draft.toDate}
                      min={draft.fromDate || undefined}
                      onChange={(e) => update({ toDate: e.target.value })}
                    />
                  </label>
                </div>
              )}
              {customDate && (
                <p className="discovery-note">한국 시간의 행사 시작 날짜를 기준으로 찾아요.</p>
              )}
            </section>
            <div className="discovery-availability">
              <div>
                <strong>신청 가능한 모임만</strong>
                <small>마감된 모집은 제외해요.</small>
              </div>
              <button
                type="button"
                className="discovery-switch"
                role="switch"
                aria-label="신청 가능한 모임만"
                aria-checked={draft.availableOnly}
                onClick={() => update({ availableOnly: !draft.availableOnly })}
              >
                <span />
              </button>
            </div>
            <button
              type="button"
              className="discovery-advanced-toggle"
              aria-expanded={advanced}
              aria-controls={advancedId}
              onClick={() => setAdvanced((before) => !before)}
            >
              <span>
                <strong>
                  <MapPin size={16} aria-hidden="true" />
                  장소·참가비
                </strong>
                <small>
                  {locationSummary} · {priceSummary}
                </small>
              </span>
              <ChevronDown size={18} aria-hidden="true" />
            </button>
            {advanced && (
              <div className="discovery-advanced" id={advancedId}>
                <section className="discovery-section">
                  <h3>어디에서 만날까요?</h3>
                  {requireLocation && (
                    <p className="discovery-location-request" role="status">
                      거리순 정렬에 사용할 기준 위치를 선택해주세요.
                    </p>
                  )}
                  <EventLocationField
                    key={locationFieldVersion}
                    value={draft.coordinates}
                    onChange={(coordinates) => update({ coordinates })}
                    purpose="search"
                  />
                  <label className="discovery-field discovery-radius">
                    선택한 위치에서
                    <select
                      aria-label="검색 반경"
                      value={draft.radiusKm ?? ""}
                      onChange={(e) =>
                        update({ radiusKm: e.target.value ? Number(e.target.value) : null })
                      }
                    >
                      <option value="">거리 제한 없이</option>
                      {[1, 3, 5, 10, 30, 100].map((distance) => (
                        <option key={distance} value={distance}>
                          {distance}km 이내
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="discovery-note">
                    거리로 찾을 때는 위치가 등록된 모임만 보여요. 실제 이동 거리와는 다를 수 있어요.
                  </p>
                </section>
                <section className="discovery-section">
                  <h3>사전 참가비는 얼마까지 괜찮나요?</h3>
                  <div className="discovery-quick-options">
                    {[
                      { label: "제한 없음", min: null, max: null },
                      { label: "사전 결제 없음", min: 0, max: 0 },
                      { label: "1만원 이하", min: 0, max: 10000 },
                      { label: "3만원 이하", min: 0, max: 30000 },
                    ].map((item) => (
                      <button
                        type="button"
                        key={item.label}
                        aria-pressed={
                          !customPrice &&
                          draft.minPriceKRW === item.min &&
                          draft.maxPriceKRW === item.max
                        }
                        onClick={() => {
                          update({ minPriceKRW: item.min, maxPriceKRW: item.max });
                          setCustomPrice(false);
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      aria-pressed={customPrice}
                      aria-expanded={customPrice}
                      onClick={() => setCustomPrice(true)}
                    >
                      직접 입력
                    </button>
                  </div>
                  {customPrice && (
                    <div className="discovery-two-columns discovery-custom-fields">
                      <label className="discovery-field">
                        최소 금액 (원)
                        <input
                          type="number"
                          min={0}
                          max={10000000}
                          step={1}
                          value={draft.minPriceKRW ?? ""}
                          placeholder="제한 없음"
                          onChange={(e) =>
                            update({ minPriceKRW: e.target.value ? Number(e.target.value) : null })
                          }
                        />
                      </label>
                      <label className="discovery-field">
                        최대 금액 (원)
                        <input
                          type="number"
                          min={0}
                          max={10000000}
                          step={1}
                          value={draft.maxPriceKRW ?? ""}
                          placeholder="제한 없음"
                          onChange={(e) =>
                            update({ maxPriceKRW: e.target.value ? Number(e.target.value) : null })
                          }
                        />
                      </label>
                    </div>
                  )}
                  <p className="discovery-note">
                    현장 비용과 개별 정산은 모임 안내를 확인해주세요.
                  </p>
                </section>
              </div>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="discovery-form-actions">
            <button type="button" className="discovery-reset" onClick={reset}>
              초기화
            </button>
            <Button type="submit">모임 찾기</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EventDiscoveryChips({
  value,
  onChange,
  onReset,
  onEdit,
}: {
  value: EventDiscoveryFilters;
  onChange: (value: EventDiscoveryFilters) => void;
  onReset: () => void;
  onEdit: () => void;
}) {
  if (!hasDiscoveryFilters(value)) return null;
  const chips: { label: string; remove: Partial<EventDiscoveryFilters> }[] = [];
  if (value.eventOnly) chips.push({ label: "이벤트만", remove: { ...DEFAULT_DISCOVERY_FILTERS } });
  if (value.meetupType !== "all")
    chips.push({
      label: value.meetupType === "lightning" ? "번개" : "일반 이벤트",
      remove: { meetupType: "all" },
    });
  if (value.coordinates)
    chips.push({
      label: value.radiusKm !== null ? `내 위치 ${value.radiusKm}km 이내` : "거리 기준 위치 설정됨",
      remove: { coordinates: null, radiusKm: null },
    });
  if (value.fromDate || value.toDate)
    chips.push({
      label: `${value.fromDate || "시작 제한 없음"} ~ ${value.toDate || "종료 제한 없음"}`,
      remove: { fromDate: "", toDate: "" },
    });
  if (value.minPriceKRW !== null || value.maxPriceKRW !== null)
    chips.push({
      label:
        value.minPriceKRW === 0 && value.maxPriceKRW === 0
          ? "사전 결제 없음"
          : `${value.minPriceKRW?.toLocaleString("ko-KR") ?? "0"} ~ ${value.maxPriceKRW?.toLocaleString("ko-KR") ?? "제한 없음"}원`,
      remove: { minPriceKRW: null, maxPriceKRW: null },
    });
  if (value.availableOnly) chips.push({ label: "신청 가능", remove: { availableOnly: false } });
  return (
    <div className="event-discovery-chips" aria-label="적용한 이벤트 필터">
      {chips.map((chip) => (
        <button
          type="button"
          key={chip.label}
          aria-label={`${chip.label} 필터 해제`}
          onClick={() => onChange({ ...value, ...chip.remove })}
        >
          {chip.label}
          <X size={13} />
        </button>
      ))}
      <button type="button" className="discovery-edit" onClick={onEdit}>
        조건 수정
      </button>
      <button type="button" className="discovery-edit" onClick={onReset}>
        모두 해제
      </button>
    </div>
  );
}
