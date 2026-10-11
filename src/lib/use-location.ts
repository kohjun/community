"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createLocationRequests, type GeoCoordinates } from "./location-request";
export type { GeoCoordinates } from "./location-request";

export function useLocation() {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const requests = useRef(createLocationRequests());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requests.current.cancel();
    };
  }, []);

  const cancelLocation = useCallback(() => {
    requests.current.cancel();
    if (mounted.current) {
      setStatus("idle");
      setError("");
    }
  }, []);

  const requestLocation = useCallback((): Promise<GeoCoordinates | null> => {
    const attempt = requests.current.begin();
    if (!mounted.current) {
      attempt.complete(null);
      return attempt.result;
    }
    if (!navigator.geolocation || !window.isSecureContext) {
      setStatus("error");
      setError(
        "이 환경에서는 현재 위치를 사용할 수 없어요. 지도에서 찾은 위도·경도를 직접 입력해주세요.",
      );
      attempt.complete(null);
      return attempt.result;
    }
    setStatus("loading");
    setError("");
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (!mounted.current || !attempt.isCurrent()) return;
          setStatus("ready");
          attempt.complete({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        },
        (failure) => {
          if (!mounted.current || !attempt.isCurrent()) return;
          setStatus("error");
          setError(
            failure.code === 1
              ? "위치 권한이 꺼져 있어요. 브라우저에서 권한을 허용하거나 위도·경도를 직접 입력해주세요."
              : failure.code === 3
                ? "위치 확인 시간이 초과됐어요. 다시 시도하거나 위도·경도를 직접 입력해주세요."
                : "현재 위치를 확인하지 못했어요. 다시 시도하거나 위도·경도를 직접 입력해주세요.",
          );
          attempt.complete(null);
        },
        { enableHighAccuracy: false, maximumAge: 60000, timeout: 12000 },
      );
    } catch {
      if (mounted.current && attempt.isCurrent()) {
        setStatus("error");
        setError("브라우저에서 위치 요청을 허용하지 않아요. 위도·경도를 직접 입력해주세요.");
        attempt.complete(null);
      }
    }
    return attempt.result;
  }, []);

  return { status, error, requestLocation, cancelLocation };
}
