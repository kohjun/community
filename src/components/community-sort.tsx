"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, LocateFixed } from "lucide-react";
import type { FeedQuery } from "@/domain/community";
import { useLocation, type GeoCoordinates } from "@/lib/use-location";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import styles from "./community-sort.module.css";

type SortOrder = NonNullable<FeedQuery["sort"]>;

export function CommunitySort({
  value,
  coordinates,
  contextKey,
  onChange,
}: {
  value: SortOrder;
  coordinates: GeoCoordinates | null;
  contextKey: string;
  onChange: (value: SortOrder, coordinates?: GeoCoordinates) => void;
}) {
  const { requestLocation, cancelLocation } = useLocation();
  const version = useRef(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    version.current++;
    cancelLocation();
    setOpen(false);
    setBusy(false);
    setDenied(false);
    setFailed(false);
    return () => {
      version.current++;
      cancelLocation();
    };
  }, [contextKey, value, cancelLocation]);

  function dismiss() {
    version.current++;
    cancelLocation();
    setOpen(false);
    setBusy(false);
    setDenied(false);
    setFailed(false);
  }

  async function locate(attempt: number) {
    const next = await requestLocation();
    if (attempt !== version.current) return;
    setBusy(false);
    if (!next) {
      setFailed(true);
      setOpen(true);
      return;
    }
    setOpen(false);
    onChange("nearest", next);
  }

  async function choose(next: SortOrder) {
    dismiss();
    if (next !== "nearest") {
      onChange(next);
      return;
    }
    if (coordinates) {
      onChange("nearest", coordinates);
      return;
    }
    const attempt = ++version.current;
    setBusy(true);
    let permission: PermissionState = "prompt";
    try {
      if (navigator.permissions) {
        permission = (await navigator.permissions.query({ name: "geolocation" })).state;
      }
    } catch {
      // Browsers without permission inspection still support an explicit user request.
    }
    if (attempt !== version.current) return;
    if (permission === "granted") {
      await locate(attempt);
    } else {
      setBusy(false);
      setDenied(permission === "denied");
      setOpen(true);
    }
  }

  const label = busy
    ? "위치 확인 중…"
    : value === "popular"
      ? "인기순"
      : value === "nearest"
        ? "거리순"
        : "최신순";

  return (
    <>
      <label className="sort-select" aria-busy={busy}>
        <select
          aria-label="게시글 정렬"
          value={value}
          disabled={busy}
          onChange={(event) => void choose(event.target.value as SortOrder)}
        >
          <option value="latest">최신순</option>
          <option value="popular">인기순</option>
          <option value="nearest">거리순</option>
        </select>
        <span className="sort-select-label" aria-hidden="true">
          {label}
        </span>
        <ChevronDown size={14} aria-hidden="true" />
        {busy && (
          <span className="sr-only" role="status">
            현재 위치를 확인하고 있어요.
          </span>
        )}
      </label>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : dismiss())}>
        <DialogContent className={styles.consent}>
          <span className={styles.icon} aria-hidden="true">
            <LocateFixed size={24} />
          </span>
          <DialogTitle className={styles.title}>내 주변 모임을 찾아볼까요?</DialogTitle>
          <DialogDescription className={styles.description}>
            내 위치를 공유하면 가까운 모집글부터 보여드려요. 위치는 정렬에만 사용하고 프로필에
            저장하지 않아요.
          </DialogDescription>
          {(denied || failed) && (
            <p className={styles.error} role="alert">
              {denied
                ? "위치 권한이 꺼져 있어요. 주소 표시줄의 사이트 설정에서 위치 권한을 허용해주세요."
                : "현재 위치를 가져오지 못했어요. 브라우저의 위치 권한과 기기의 위치 설정을 확인하고 다시 시도해주세요."}
            </p>
          )}
          <div className={styles.actions}>
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                const attempt = ++version.current;
                setBusy(true);
                setDenied(false);
                setFailed(false);
                void locate(attempt);
              }}
            >
              {busy ? "위치 확인 중…" : "내 위치 공유하고 정렬"}
            </Button>
            <Button type="button" variant="ghost" onClick={dismiss}>
              나중에
            </Button>
          </div>
          <p className={styles.note}>위치가 등록된 모집글을 직선거리 기준으로 정렬해요.</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
