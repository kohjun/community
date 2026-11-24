"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { LocateFixed, MapPin, Search, X, ExternalLink } from "lucide-react";
import { Button } from "./ui/button";
import { useLocation } from "@/lib/use-location";
import { naverPlaceLink } from "@/lib/naver-maps";
import type { VenuePoint } from "@/domain/discovery";
import { NaverLocationPicker } from "./naver-location-picker";

export function EventLocationField({
  value,
  address = "",
  onChange,
  onAddressSelected,
  disabled = false,
  purpose = "venue",
  idPrefix,
  addressMaxLength = 120,
}: {
  value: VenuePoint | null;
  address?: string;
  onChange: (next: VenuePoint | null) => void;
  onAddressSelected?: (address: string) => void;
  disabled?: boolean;
  purpose?: "search" | "venue";
  idPrefix?: string;
  addressMaxLength?: number;
}) {
  const generatedId = useId(),
    id = idPrefix ?? generatedId;
  const [pickerOpen, setPickerOpen] = useState(false);
  const location = useLocation();
  const mounted = useRef(true),
    selectionVersion = useRef(0);
  const { cancelLocation } = location;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      selectionVersion.current++;
    };
  }, []);
  useEffect(() => {
    selectionVersion.current++;
    cancelLocation();
  }, [value?.latitude, value?.longitude, value?.communityVenueId, cancelLocation]);
  useEffect(() => {
    if (disabled) {
      selectionVersion.current++;
      cancelLocation();
    }
  }, [disabled, cancelLocation]);
  const displayAddress = address || value?.address || "";
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
              onChange(next);
              onAddressSelected?.(next.address);
              setPickerOpen(false);
            }}
          />
        </div>
      )}
      {value?.communityVenueId && (
        <div className="location-place-selected" role="status">
          <MapPin size={15} />
          <span>
            <strong>{displayAddress || "이벤트 맵 장소"}</strong>
            {displayAddress && <small>이벤트 맵 장소와 연결됐어요</small>}
          </span>
          <Link href={"/places/" + value.communityVenueId}>행사 기록</Link>
        </div>
      )}

      <p className="location-field-note">
        {purpose === "search"
          ? "내 주변 위치는 검색에만 사용해요. 다른 지역은 주소나 지도에서 선택할 수 있어요."
          : "모임이 열리는 주소를 검색하고 지도에서 확인해주세요."}
      </p>
      {purpose === "search" && location.error && (
        <p className="form-error" role="alert">
          {location.error}
        </p>
      )}
    </div>
  );
}
