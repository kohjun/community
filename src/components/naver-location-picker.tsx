"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Check, ExternalLink, LoaderCircle, MapPin, Search, X } from "lucide-react";
import {
  geocodeAddress,
  reverseGeocodePoint,
  type GeocodedAddress,
  type MapPoint,
} from "@/lib/naver-maps";
import { NaverEventMap } from "./naver-event-map";
import styles from "./naver-location-picker.module.css";

type Selection = MapPoint & { address: string };
export function NaverLocationPicker({
  value,
  address = "",
  disabled = false,
  maxLength = 120,
  onSelect,
  onCancel,
}: {
  value: MapPoint | null;
  address?: string;
  disabled?: boolean;
  maxLength?: number;
  onSelect: (next: Selection) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodedAddress[] | null>(null);
  const [candidate, setCandidate] = useState<Selection | null>(
    value && address ? { ...value, address } : null,
  );
  const [detail, setDetail] = useState("");
  const [focus, setFocus] = useState<MapPoint | null>(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const queryInput = useRef<HTMLInputElement>(null);
  const keyId = process.env.NEXT_PUBLIC_NAVER_MAP_KEY_ID?.trim() || null;
  useEffect(() => {
    queryInput.current?.focus({ preventScroll: true });
    return () => request.current?.abort();
  }, []);
  useEffect(() => {
    if (disabled) {
      request.current?.abort();
      setBusy(false);
    }
  }, [disabled]);
  function cancelRequest() {
    request.current?.abort();
    setBusy(false);
    setError("");
  }
  async function search() {
    if (disabled || busy || !query.trim()) return;
    cancelRequest();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setResults(null);
    try {
      const found = await geocodeAddress(query, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setResults(found);
      if (!found.length)
        setError("일치하는 주소가 없어요. 도로명·건물 번호 또는 지번으로 검색해주세요.");
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "주소를 검색하지 못했어요.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function pick(point: MapPoint) {
    if (disabled) return;
    cancelRequest();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setCandidate(null);
    setDetail("");
    setFocus(point);
    setResults(null);
    try {
      const found = await reverseGeocodePoint(point, { signal: controller.signal });
      if (!controller.signal.aborted) setCandidate(found);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "주소를 확인하지 못했어요.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const label = candidate ? [candidate.address, detail.trim()].filter(Boolean).join(" · ") : "";
  const tooLong = label.length > maxLength;
  return (
    <section className={styles.picker} aria-label="네이버 지도에서 장소 선택">
      <div className={styles.heading}>
        <div>
          <strong>어디에서 만날까요?</strong>
          <p>주소를 찾고 지도에서 만날 지점을 확인해주세요.</p>
        </div>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="장소 선택 닫기"
          disabled={disabled}
          onClick={onCancel}
        >
          <X size={19} />
        </button>
      </div>
      <label htmlFor={`${id}-query`} className={styles.label}>
        주소 검색
      </label>
      <div className={styles.query}>
        <Search size={18} aria-hidden="true" />
        <input
          ref={queryInput}
          id={`${id}-query`}
          value={query}
          maxLength={200}
          disabled={disabled || !keyId}
          placeholder="예: 서울 강남구 영동대로 513"
          onChange={(e) => {
            cancelRequest();
            setQuery(e.target.value);
            setResults(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.stopPropagation();
              void search();
            }
          }}
        />
        <button
          type="button"
          disabled={disabled || busy || !keyId || query.trim().length < 2}
          onClick={() => void search()}
        >
          검색
        </button>
      </div>
      <p className={styles.hint}>
        장소 이름만으로 찾기 어렵다면{" "}
        <a
          href={"https://map.naver.com/p/search/" + encodeURIComponent(query || "모임 장소")}
          target="_blank"
          rel="noopener noreferrer"
        >
          네이버 지도에서 주소 확인 <ExternalLink size={11} />
        </a>
      </p>
      {results && results.length > 0 && (
        <ul className={styles.results} aria-label="주소 검색 결과">
          {results.map((result, index) => (
            <li key={index}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  cancelRequest();
                  setCandidate(result);
                  setFocus({ ...result });
                  setDetail("");
                  setResults(null);
                }}
              >
                <MapPin size={17} />
                <span>
                  <strong>{result.address}</strong>
                  {result.jibunAddress && result.jibunAddress !== result.roadAddress && (
                    <small>지번 {result.jibunAddress}</small>
                  )}
                </span>
                <span>선택</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.map}>
        <NaverEventMap
          clientId={keyId}
          pins={
            candidate
              ? [{ ...candidate, id: "chosen-location", kind: "place", label: "만나는 곳" }]
              : []
          }
          selectedId={candidate ? "chosen-location" : null}
          onSelect={() => {}}
          onBoundsChange={() => {}}
          picking={!disabled}
          onPick={(point) => void pick(point)}
          focusPoint={focus ? { ...focus, zoom: 16 } : null}
        />
      </div>
      <p className={styles.hint}>지도에서 정확한 입구나 만날 지점을 눌러 조정할 수 있어요.</p>
      {busy && (
        <p className={styles.status} role="status">
          <LoaderCircle size={15} className={styles.spinner} />
          주소를 확인하고 있어요.
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {candidate && (
        <div className={styles.selected}>
          <MapPin size={18} />
          <div>
            <small>선택한 주소</small>
            <strong>{candidate.address}</strong>
          </div>
          <Check size={17} />
        </div>
      )}
      <label className={styles.label} htmlFor={`${id}-detail`}>
        상세 장소·만나는 곳 <span>선택</span>
      </label>
      <input
        className={styles.detail}
        id={`${id}-detail`}
        value={detail}
        maxLength={maxLength}
        disabled={disabled || !candidate || busy}
        placeholder="예: 동문 입구 앞 · 2층 슬리퍼 라운지"
        onChange={(e) => setDetail(e.target.value)}
      />
      {tooLong && (
        <p className={styles.error} role="alert">
          주소와 상세 안내를 합쳐 {maxLength}자 이내로 입력해주세요.
        </p>
      )}
      <div className={styles.actions}>
        <button type="button" disabled={disabled} onClick={onCancel}>
          취소
        </button>
        <button
          type="button"
          className={styles.confirm}
          disabled={disabled || busy || !candidate || tooLong}
          onClick={() => {
            if (candidate && !busy && !disabled && !tooLong) {
              cancelRequest();
              onSelect({
                latitude: candidate.latitude,
                longitude: candidate.longitude,
                address: label,
              });
            }
          }}
        >
          <Check size={16} />이 위치로 선택
        </button>
      </div>
    </section>
  );
}
