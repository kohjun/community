"use client";

import Script from "next/script";
import { MapPin as MapPinIcon, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getNaverMapsSDK,
  NaverMapSession,
  naverMapsScriptUrl,
  subscribeNaverAuthFailure,
  type MapBounds,
  type MapPin,
  type MapPoint,
  type NaverRuntime,
} from "@/lib/naver-maps";

export type NaverEventMapProps = {
  clientId: string | null;
  pins: MapPin[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onBoundsChange: (bounds: MapBounds) => void;
  picking: boolean;
  onPick: (point: MapPoint) => void;
  focusPoint?: (MapPoint & { zoom?: number }) | null;
};

type MapState = { phase: "loading" | "ready" | "error"; message: string };
const INITIAL_STATE: MapState = { phase: "loading", message: "" };

function hasMapSize(element: HTMLElement | null) {
  return Boolean(element && element.clientWidth > 0 && element.clientHeight > 0);
}

export function NaverEventMap(props: NaverEventMapProps) {
  const { clientId, pins, selectedId, picking, focusPoint } = props;
  const [state, setState] = useState<MapState>(INITIAL_STATE);
  const initializeRef = useRef<(() => void) | null>(null);
  const failureRef = useRef<((message: string) => void) | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const session = useRef<NaverMapSession | null>(null);
  const pendingFocus = useRef(false);
  const propsRef = useRef(props);
  propsRef.current = props;
  const markScriptReady = useCallback(() => initializeRef.current?.(), []);

  useEffect(() => {
    if (!clientId?.trim() || !host.current) return;
    let live = true;
    let failed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let observer: ResizeObserver | undefined;
    const pauseLoading = () => {
      clearTimeout(timer);
      clearTimeout(deadline);
      timer = undefined;
      deadline = undefined;
    };
    const setFailure = (message: string) => {
      if (!live) return;
      failed = true;
      pauseLoading();
      observer?.disconnect();
      session.current?.dispose();
      session.current = null;
      setState({ phase: "error", message });
    };
    const startDeadline = () => {
      if (deadline !== undefined) return;
      deadline = setTimeout(() => {
        deadline = undefined;
        if (!hasMapSize(host.current)) {
          pauseLoading();
          return;
        }
        setFailure("지도 연결이 지연되고 있어요. 네트워크 연결을 확인하고 다시 시도해 주세요.");
      }, 12000);
    };
    failureRef.current = setFailure;
    const unsubscribe = subscribeNaverAuthFailure(
      () => setFailure("지도 연결을 확인하지 못했어요. 잠시 후 다시 시도해 주세요."),
      window as NaverRuntime,
    );
    setState(INITIAL_STATE);
    const initialize = () => {
      if (!live || failed) return;
      clearTimeout(timer);
      timer = undefined;
      if (!hasMapSize(host.current)) {
        pauseLoading();
        // ResizeObserver resumes when a hidden mobile map is shown. Older browsers use a slower retry.
        if (!observer) timer = setTimeout(initialize, 500);
        return;
      }
      if (session.current) return;
      startDeadline();
      const sdk = getNaverMapsSDK();
      if (!sdk || !host.current) {
        timer = setTimeout(initialize, 100);
        return;
      }
      try {
        const current = propsRef.current;
        const map = new NaverMapSession(
          sdk,
          host.current,
          {
            onSelect: (id) => propsRef.current.onSelect(id),
            onBoundsChange: (bounds) => {
              if (hasMapSize(host.current)) propsRef.current.onBoundsChange(bounds);
            },
            onPick: (point) => propsRef.current.onPick(point),
          },
          current.focusPoint ?? undefined,
        );
        session.current = map;
        map.update(current.pins, current.selectedId, current.picking);
        if (current.focusPoint) map.focus(current.focusPoint);
        pendingFocus.current = false;
        pauseLoading();
        setState({ phase: "ready", message: "" });
      } catch {
        setFailure("지도를 불러오지 못했어요. 새로고침하거나 잠시 후 다시 시도해 주세요.");
      }
    };
    initializeRef.current = initialize;
    const resize = () => {
      if (!live || failed) return;
      if (!hasMapSize(host.current)) {
        pauseLoading();
        return;
      }
      const map = session.current;
      if (!map) {
        initialize();
        return;
      }
      const current = propsRef.current;
      map.resize();
      map.update(current.pins, current.selectedId, current.picking);
      if (pendingFocus.current && current.focusPoint) map.focus(current.focusPoint);
      pendingFocus.current = false;
    };
    // Observe before initialization so display:none does not create a zero-size map or start a timeout.
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(resize);
      observer.observe(host.current);
    }
    window.addEventListener("resize", resize);
    // A cached SDK is immediately usable when this route mounts again. The geocoder may finish after onReady.
    initialize();
    return () => {
      live = false;
      initializeRef.current = null;
      failureRef.current = null;
      pauseLoading();
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      unsubscribe();
      session.current?.dispose();
      session.current = null;
    };
  }, [clientId]);

  useEffect(() => {
    if (hasMapSize(host.current)) session.current?.update(pins, selectedId, picking);
  }, [pins, selectedId, picking]);

  useEffect(() => {
    if (!focusPoint) {
      pendingFocus.current = false;
      return;
    }
    if (hasMapSize(host.current) && session.current) {
      session.current.focus(focusPoint);
      pendingFocus.current = false;
    } else pendingFocus.current = true;
  }, [focusPoint?.latitude, focusPoint?.longitude, focusPoint?.zoom]);

  const configured = Boolean(clientId?.trim());
  const ready = configured && state.phase === "ready";
  const retry = () => window.location.reload();

  return (
    <div className={`naver-event-map${picking && ready ? " is-picking" : ""}`}>
      <div
        ref={host}
        className="naver-event-map-canvas"
        aria-label="이벤트와 함께 만드는 장소 지도"
      />
      {!ready && (
        <div className="naver-event-map-status" role="status" aria-live="polite">
          <span className="naver-event-map-status-icon">
            {configured && state.phase === "loading" ? (
              <LoaderCircle aria-hidden="true" className="is-loading" />
            ) : (
              <MapPinIcon aria-hidden="true" />
            )}
          </span>
          <strong>
            {!configured
              ? "지도를 준비하고 있어요"
              : state.phase === "error"
                ? "지도를 열지 못했어요"
                : "주변 장소를 불러오고 있어요"}
          </strong>
          <p>
            {!configured
              ? "지도가 연결되면 우리가 찾은 장소를 함께 채울 수 있어요. 지금은 장소 목록을 둘러보세요."
              : state.phase === "error"
                ? state.message
                : "네이버 지도로 곧 연결됩니다."}
          </p>
          {configured && state.phase === "error" && (
            <button type="button" onClick={retry}>
              <RefreshCw size={15} aria-hidden="true" /> 다시 연결
            </button>
          )}
        </div>
      )}
      {configured && (
        <Script
          key={clientId}
          id="sliper-naver-map"
          src={naverMapsScriptUrl(clientId!)}
          strategy="afterInteractive"
          onReady={markScriptReady}
          onError={() =>
            failureRef.current?.(
              "지도에 연결하지 못했어요. 네트워크 연결을 확인하고 다시 시도해 주세요.",
            )
          }
        />
      )}
    </div>
  );
}
