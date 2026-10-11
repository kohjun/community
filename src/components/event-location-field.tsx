"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { LocateFixed, MapPin, Search, X } from "lucide-react";
import { Button } from "./ui/button";
import { useLocation } from "@/lib/use-location";
import type { VenuePoint } from "@/domain/discovery";
import type { CommunityVenue, EventMapSnapshot } from "@/domain/event-map";
import { appRequest } from "@/lib/api-client";

export function EventLocationField({
  value,
  onChange,
  onPlaceSelected,
  disabled = false,
  purpose = "venue",
  allowSharedPlaces = purpose === "venue",
  idPrefix,
}: {
  value: VenuePoint | null;
  onChange: (next: VenuePoint | null) => void;
  onPlaceSelected?: (place: CommunityVenue) => void;
  disabled?: boolean;
  purpose?: "search" | "venue";
  allowSharedPlaces?: boolean;
  idPrefix?: string;
}) {
  const generatedId = useId();
  const id = idPrefix ?? generatedId;
  const [latitude, setLatitude] = useState(value ? String(value.latitude) : "");
  const [longitude, setLongitude] = useState(value ? String(value.longitude) : "");
  const [manual, setManual] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [placeOpen, setPlaceOpen] = useState(false);
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeResults, setPlaceResults] = useState<CommunityVenue[] | null>(null);
  const [placeBusy, setPlaceBusy] = useState(false);
  const [placeError, setPlaceError] = useState("");
  const [placesTruncated, setPlacesTruncated] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<CommunityVenue | null>(null);
  const placeRequest = useRef<AbortController | null>(null);
  const location = useLocation();
  const mounted = useRef(true);
  const selectionVersion = useRef(0);
  const { cancelLocation } = location;
  function invalidateLocation() {
    selectionVersion.current += 1;
    cancelLocation();
  }
  function unlinkPlace() {
    if (value?.communityVenueId) onChange({ latitude: value.latitude, longitude: value.longitude });
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      selectionVersion.current += 1;
      placeRequest.current?.abort();
    };
  }, []);
  useEffect(() => {
    selectionVersion.current += 1;
    cancelLocation();
    setLatitude(value ? String(value.latitude) : "");
    setLongitude(value ? String(value.longitude) : "");
    setValidationError("");
    setSelectedPlace((before) => (before?.id === value?.communityVenueId ? before : null));
  }, [
    value?.latitude,
    value?.longitude,
    value?.communityVenueId,
    value?.communityVenueVersion,
    cancelLocation,
  ]);
  useEffect(() => {
    if (disabled) {
      selectionVersion.current += 1;
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
      if (!mounted.current || controller.signal.aborted) return;
      setPlaceError(cause instanceof Error ? cause.message : "공유 장소를 찾지 못했어요.");
    } finally {
      if (mounted.current && !controller.signal.aborted) setPlaceBusy(false);
    }
  }
  function choosePlace(place: CommunityVenue) {
    invalidateLocation();
    setManual(false);
    setSelectedPlace(place);
    setPlaceOpen(false);
    setValidationError("");
    onChange({
      latitude: place.latitude,
      longitude: place.longitude,
      communityVenueId: place.id,
      communityVenueVersion: place.version,
    });
    onPlaceSelected?.(place);
  }
  function applyManual() {
    invalidateLocation();
    const lat = Number(latitude),
      lng = Number(longitude);
    if (
      !latitude.trim() ||
      !longitude.trim() ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      setValidationError("위도는 -90~90, 경도는 -180~180 범위로 모두 입력해주세요.");
      return;
    }
    setValidationError("");
    onChange({ latitude: lat, longitude: lng });
  }

  return (
    <div className="event-location-field">
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
            {selectedPlace && <small>{selectedPlace.address}</small>}
          </span>
          <Link href={"/places/" + value.communityVenueId}>행사 기록</Link>
        </div>
      )}
      <div className="location-field-actions">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || location.status === "loading"}
          onClick={async () => {
            const version = ++selectionVersion.current;
            const next = await location.requestLocation();
            if (next && mounted.current && selectionVersion.current === version) onChange(next);
          }}
        >
          <LocateFixed size={16} />
          {location.status === "loading" ? "위치 확인 중…" : "현재 위치 사용"}
        </Button>
        <button
          type="button"
          className="location-manual-toggle"
          disabled={disabled}
          aria-expanded={manual}
          aria-controls={`${id}-manual`}
          onClick={() => {
            invalidateLocation();
            if (!manual) unlinkPlace();
            setManual((current) => !current);
          }}
        >
          좌표 직접 입력
        </button>
        {value && (
          <button
            type="button"
            className="location-clear"
            disabled={disabled}
            aria-label="설정한 위치 지우기"
            onClick={() => {
              invalidateLocation();
              onChange(null);
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>
      {value && (
        <p className="location-selected" role="status">
          <MapPin size={15} />
          {value.latitude.toFixed(4)}, {value.longitude.toFixed(4)}
          <span>{value.communityVenueId ? "공유 장소 좌표" : "좌표 설정됨"}</span>
        </p>
      )}
      <p className="location-field-note">
        {purpose === "search"
          ? "버튼을 누를 때만 위치를 확인해요. 검색 위치는 프로필에 저장하지 않아요. 거리 검색에는 공개 행사장 좌표만 사용해요."
          : allowSharedPlaces
            ? "공유 장소를 선택하거나 행사장 좌표를 직접 지정해주세요. 공유 장소를 사용한 완료 행사는 장소의 행사 기록에 연결돼요. 현재 위치는 행사장일 때만 사용해주세요."
            : "모임 장소의 좌표를 지정해주세요. 참가자가 거리로 찾을 수 있는 공개 행사장 위치예요. 현재 위치가 행사장일 때만 사용해주세요."}
      </p>
      {manual && (
        <div id={`${id}-manual`} className="location-manual-fields">
          <label htmlFor={`${id}-latitude`}>
            위도
            <input
              id={`${id}-latitude`}
              type="number"
              min={-90}
              max={90}
              step="any"
              inputMode="decimal"
              value={latitude}
              disabled={disabled}
              placeholder="예: 37.5665"
              onChange={(e) => {
                invalidateLocation();
                unlinkPlace();
                setLatitude(e.target.value);
              }}
            />
          </label>
          <label htmlFor={`${id}-longitude`}>
            경도
            <input
              id={`${id}-longitude`}
              type="number"
              min={-180}
              max={180}
              step="any"
              inputMode="decimal"
              value={longitude}
              disabled={disabled}
              placeholder="예: 126.9780"
              onChange={(e) => {
                invalidateLocation();
                unlinkPlace();
                setLongitude(e.target.value);
              }}
            />
          </label>
          <Button type="button" variant="outline" disabled={disabled} onClick={applyManual}>
            좌표 적용
          </Button>
          <small>지도 서비스에서 행사장 위도·경도를 확인해 입력할 수 있어요.</small>
        </div>
      )}
      {(validationError || location.error) && (
        <p className="form-error" role="alert">
          {validationError || location.error}
        </p>
      )}
    </div>
  );
}
