"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CalendarDays, MapPin, SlidersHorizontal, X, Zap } from "lucide-react";
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
    >
      <SlidersHorizontal size={16} />
      <span>취향 이벤트 찾기</span>
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
  useEffect(() => {
    if (!open) return;
    setDraft({ ...value, eventOnly: true });
    setDraftCategory(category);
    setError("");
  }, [open, value, category]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if ((requireLocation || draft.radiusKm !== null) && !draft.coordinates) {
      setError("거리 검색을 하려면 현재 위치를 사용하거나 위도·경도를 입력해 적용해주세요.");
      return;
    }
    if (draft.fromDate && draft.toDate && draft.fromDate > draft.toDate) {
      setError("마지막 날짜는 시작 날짜 이후로 설정해주세요.");
      return;
    }
    if (
      draft.minPriceKRW !== null &&
      draft.maxPriceKRW !== null &&
      draft.minPriceKRW > draft.maxPriceKRW
    ) {
      setError("최대 참가비는 최소 참가비 이상이어야 해요.");
      return;
    }
    setError("");
    onApply(draft, draftCategory);
    onOpenChange(false);
  }
  const update = (next: Partial<EventDiscoveryFilters>) =>
    setDraft((current) => ({ ...current, ...next }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-discovery-dialog">
        <div className="discovery-dialog-heading">
          <span>
            <SlidersHorizontal size={18} />
            나에게 맞는 즐거움
          </span>
          <DialogTitle>취향 이벤트 찾기</DialogTitle>
          <DialogDescription>
            가까운 모임부터 일정과 예산에 맞는 이벤트까지 골라보세요.
          </DialogDescription>
        </div>
        <form className="discovery-form" onSubmit={submit}>
          <section className="discovery-section">
            <h3>어떤 모임을 찾나요?</h3>
            <div className="discovery-kind-options">
              {(
                [
                  { value: "all", label: "모든 이벤트" },
                  { value: "lightning", label: "번개 · 소규모 모임" },
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
                  {item.value === "lightning" && <Zap size={15} />}
                  {item.label}
                </button>
              ))}
            </div>
            <label className="discovery-field">
              카테고리
              <select
                value={draftCategory}
                onChange={(e) => setDraftCategory(e.target.value as CategorySlug | "all")}
              >
                <option value="all">모든 카테고리</option>
                {CATEGORIES.map((item) => (
                  <option key={item.slug} value={item.slug}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <section className="discovery-section">
            <h3>
              <MapPin size={17} />내 주변에서
            </h3>
            {requireLocation && (
              <p className="discovery-location-request" role="status">
                가까운순 정렬에 사용할 기준 위치를 설정해주세요.
              </p>
            )}
            <EventLocationField
              key={locationFieldVersion}
              value={draft.coordinates}
              onChange={(coordinates) => update({ coordinates })}
              purpose="search"
            />
            <label className="discovery-field discovery-radius">
              검색 반경
              <select
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
              거리 필터·가까운순에는 위치가 등록된 모집글만 표시돼요. 직선거리 기준이며 실제 이동
              거리와 다를 수 있어요.
            </p>
          </section>
          <section className="discovery-section">
            <h3>
              <CalendarDays size={17} />
              언제 만날까요?
            </h3>
            <div className="discovery-quick-options">
              <button type="button" onClick={() => update(dateRange(false))}>
                오늘
              </button>
              <button type="button" onClick={() => update(dateRange(true))}>
                이번 주
              </button>
              <button type="button" onClick={() => update({ fromDate: "", toDate: "" })}>
                기간 제한 없이
              </button>
            </div>
            <div className="discovery-two-columns">
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
            <p className="discovery-note">한국 시간의 행사 시작 날짜를 기준으로 찾아요.</p>
          </section>
          <section className="discovery-section">
            <h3>참가비와 모집 상태</h3>
            <div className="discovery-quick-options">
              <button
                type="button"
                className={draft.minPriceKRW === 0 && draft.maxPriceKRW === 0 ? "selected" : ""}
                onClick={() => update({ minPriceKRW: 0, maxPriceKRW: 0 })}
              >
                무료만
              </button>
              <button
                type="button"
                onClick={() => update({ minPriceKRW: null, maxPriceKRW: null })}
              >
                비용 제한 없이
              </button>
            </div>
            <div className="discovery-two-columns">
              <label className="discovery-field">
                최소 참가비 (원)
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
                최대 참가비 (원)
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
            <label className="discovery-checkbox">
              <input
                type="checkbox"
                checked={draft.availableOnly}
                onChange={(e) => update({ availableOnly: e.target.checked })}
              />
              신청 가능한 모집만 보기
            </label>
          </section>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="discovery-form-actions">
            <button
              type="button"
              className="discovery-reset"
              onClick={() => {
                setLocationFieldVersion((current) => current + 1);
                setDraft({ ...DEFAULT_DISCOVERY_FILTERS, eventOnly: true });
                setDraftCategory("all");
                setError("");
              }}
            >
              설정 초기화
            </button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit">이벤트 찾기</Button>
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
          ? "무료"
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
