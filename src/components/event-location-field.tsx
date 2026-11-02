"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { LocateFixed, MapPin, Search, X, ExternalLink } from "lucide-react";
import { Button } from "./ui/button";
import { useLocation } from "@/lib/use-location";
import { naverPlaceLink } from "@/lib/naver-maps";
import { meetupVenueLabel } from "@/domain/venue-meetup";
import type { VenuePoint } from "@/domain/discovery";
import type { CommunityVenue, EventMapSnapshot } from "@/domain/event-map";
import { appRequest } from "@/lib/api-client";
import { NaverLocationPicker } from "./naver-location-picker";

export function EventLocationField({
  value,
  address = "",
  onChange,
  onAddressSelected,
  onPlaceSelected,
  disabled = false,
  purpose = "venue",
  allowSharedPlaces = purpose === "venue",
  idPrefix,
  addressMaxLength = 120,
}: {
  value: VenuePoint | null;
  address?: string;
  onChange: (next: VenuePoint | null) => void;
  onAddressSelected?: (address: string) => void;
  onPlaceSelected?: (place: CommunityVenue) => void;
  disabled?: boolean;
  purpose?: "search" | "venue";
  allowSharedPlaces?: boolean;
  idPrefix?: string;
  addressMaxLength?: number;
}) {
  const generatedId = useId(),
    id = idPrefix ?? generatedId;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeResults, setPlaceResults] = useState<CommunityVenue[] | null>(null);
  const [placeBusy, setPlaceBusy] = useState(false);
  const [placeError, setPlaceError] = useState("");
  const [placesTruncated, setPlacesTruncated] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<CommunityVenue | null>(null);
  const placeRequest = useRef<AbortController | null>(null);
  const location = useLocation();
  const mounted = useRef(true),
    selectionVersion = useRef(0);
  const { cancelLocation } = location;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      selectionVersion.current++;
      placeRequest.current?.abort();
    };
  }, []);
  useEffect(() => {
    selectionVersion.current++;
    cancelLocation();
    setSelectedPlace((before) => (before?.id === value?.communityVenueId ? before : null));
  }, [value?.latitude, value?.longitude, value?.communityVenueId, cancelLocation]);
  useEffect(() => {
    if (disabled) {
      selectionVersion.current++;
      cancelLocation();
      placeRequest.current?.abort();
      setPlaceBusy(false);
    }
  }, [disabled, cancelLocation]);
  async function searchPlaces() {
    if (disabled) return;
    placeRequest.current?.abort();
    const controller = new AbortController();
    placeRequest.current = controller;
    setPlaceBusy(true);
    setPlaceError("");
    setPlaceResults(null);
    try {
      const params = new URLSearchParams({ q: placeQuery.trim(), mode: "place" });
      const result = await appRequest<EventMapSnapshot>(
        "/api/event-map?" + params,
        "GET",
        undefined,
        controller.signal,
      );
      if (!mounted.current || controller.signal.aborted) return;
      setPlaceResults(result.venues.slice(0, 8));
      setPlacesTruncated(result.truncated || result.venues.length > 8);
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted)
        setPlaceError(cause instanceof Error ? cause.message : "공유 장소를 찾지 못했어요.");
    } finally {
      if (mounted.current && !controller.signal.aborted) setPlaceBusy(false);
    }
  }
  function choosePlace(place: CommunityVenue) {
    selectionVersion.current++;
    cancelLocation();
    placeRequest.current?.abort();
    setPlaceBusy(false);
    setPickerOpen(false);
    setSelectedPlace(place);
    setPlaceOpen(false);
    onChange({
      latitude: place.latitude,
      longitude: place.longitude,
      communityVenueId: place.id,
      communityVenueVersion: place.version,
      address: meetupVenueLabel(place),
    });
    onPlaceSelected?.(place);
  }
  const displayAddress = address || value?.address || selectedPlace?.address || "";
  return (
    <div className="event-location-field">
      <div className="location-field-actions">
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-expanded={pickerOpen}
          aria-controls={`${id}-map-picker`}
          onClick={() => {
            selectionVersion.current++;
            cancelLocation();
            setPickerOpen((before) => !before);
            setPlaceOpen(false);
          }}
        >
          <Search size={16} />
          {value ? "주소·지도 확인 / 변경" : "주소·지도에서 선택"}
        </Button>
        {purpose === "search" && (
          <Button
            type="button"
            variant="outline"
            disabled={disabled || location.status === "loading"}
            onClick={async () => {
              const version = ++selectionVersion.current;
              const next = await location.requestLocation();
              if (next && mounted.current && selectionVersion.current === version) {
                onChange(next);
                setPickerOpen(false);
              }
            }}
          >
            <LocateFixed size={16} />
            {location.status === "loading" ? "위치 확인 중…" : "내 주변에서 찾기"}
          </Button>
        )}
        {value && (
          <button
            type="button"
            className="location-clear"
            disabled={disabled}
            aria-label="설정한 위치 지우기"
            onClick={() => {
              selectionVersion.current++;
              cancelLocation();
              setPickerOpen(false);
              onChange(null);
              onAddressSelected?.("");
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>
      {value && !value.communityVenueId && (
        <div className="location-address-selected" role="status">
          <MapPin size={17} />
          <div>
            <strong>
              {displayAddress ||
                (purpose === "search" ? "내 주변 검색 위치가 설정됐어요" : "등록된 지도 위치")}
            </strong>
            {!displayAddress && purpose === "venue" && (
              <small>주소·지도 확인을 눌러 정확한 주소를 선택해주세요.</small>
            )}
          </div>
          <a
            href={naverPlaceLink(value, displayAddress || "모임 장소")}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="선택한 장소를 네이버 지도에서 보기"
          >
            <ExternalLink size={16} />
          </a>
        </div>
      )}
      {!value && address && <p className="location-field-note">기존 장소 안내: {address}</p>}
      {pickerOpen && (
        <div id={`${id}-map-picker`} className="location-map-picker">
          <NaverLocationPicker
            value={value}
            address={displayAddress}
            disabled={disabled}
            maxLength={addressMaxLength}
            onCancel={() => setPickerOpen(false)}
            onSelect={(next) => {
              selectionVersion.current++;
              cancelLocation();
              setSelectedPlace(null);
              onChange(next);
              onAddressSelected?.(next.address);
              setPickerOpen(false);
            }}
          />
        </div>
      )}
      {allowSharedPlaces && (
        <div className="location-place-picker">
          <button
            type="button"
            className="location-place-toggle"
            disabled={disabled}
            aria-expanded={placeOpen}
            aria-controls={`${id}-places`}
            onClick={() => setPlaceOpen((before) => !before)}
          >
            <Search size={15} /> 공유 장소에서 선택
          </button>
          {placeOpen && (
            <div id={`${id}-places`} className="location-place-search">
              <label htmlFor={`${id}-place-query`}>장소 이름·주소 검색</label>
              <div className="location-place-query">
                <input
                  id={`${id}-place-query`}
                  value={placeQuery}
                  maxLength={100}
                  disabled={disabled}
                  placeholder="예: 성수, 보드게임 라운지"
                  onChange={(event) => {
                    placeRequest.current?.abort();
                    setPlaceBusy(false);
                    setPlaceQuery(event.target.value);
                    setPlaceResults(null);
                    setPlaceError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      void searchPlaces();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled || placeBusy}
                  onClick={() => void searchPlaces()}
                >
                  {placeBusy ? "찾는 중…" : "검색"}
                </Button>
              </div>
              {placeBusy && <p role="status">공유 장소를 찾고 있어요.</p>}
              {placeError && (
                <p className="form-error" role="alert">
                  {placeError}
                </p>
              )}
              {placeResults && (
                <>
                  <ul className="location-place-results" aria-label="공유 장소 검색 결과">
                    {placeResults.map((place) => (
                      <li key={place.id}>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => choosePlace(place)}
                        >
                          <MapPin size={15} />
                          <span>
                            <strong>{place.name}</strong>
                            <small>{place.address}</small>
                          </span>
                          <span>선택</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {!placeResults.length && (
                    <p role="status">
                      검색 결과가 없어요. 다른 이름으로 찾거나 장소를 직접 입력해주세요.
                    </p>
                  )}
                  {placesTruncated && (
                    <p>일부 장소를 표시했어요. 이름이나 주소를 더 구체적으로 입력해주세요.</p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
      {value?.communityVenueId && (
        <div className="location-place-selected" role="status">
          <MapPin size={15} />
          <span>
            <strong>{selectedPlace?.name ?? "공유 장소 연결됨"}</strong>
            {(selectedPlace?.address || displayAddress) && (
              <small>{selectedPlace?.address || displayAddress}</small>
            )}
          </span>
          <Link href={"/places/" + value.communityVenueId}>행사 기록</Link>
        </div>
      )}

      <p className="location-field-note">
        {purpose === "search"
          ? "내 주변 위치는 검색에만 사용해요. 다른 지역은 주소나 지도에서 선택할 수 있어요."
          : "모임이 열리는 주소를 검색하고 지도에서 확인해주세요. 공유 장소를 선택하면 완료 행사의 장소 기록도 연결돼요."}
      </p>
      {purpose === "search" && location.error && (
        <p className="form-error" role="alert">
          {location.error}
        </p>
      )}
    </div>
  );
}
