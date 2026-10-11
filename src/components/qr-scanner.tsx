"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, Image as ImageIcon } from "lucide-react";
import type { IScannerControls } from "@zxing/browser";
export function QrScanner({
  onRead,
  disabled = false,
}: {
  onRead: (value: string) => void;
  disabled?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null),
    controls = useRef<IScannerControls | null>(null),
    generation = useRef(0),
    detected = useRef(false),
    callback = useRef(onRead);
  callback.current = onRead;
  const [running, setRunning] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  function stop() {
    generation.current++;
    controls.current?.stop();
    controls.current = null;
    const stream = video.current?.srcObject;
    if (typeof MediaStream !== "undefined" && stream instanceof MediaStream)
      stream.getTracks().forEach((t) => t.stop());
    if (video.current) video.current.srcObject = null;
    setRunning(false);
    setLoading(false);
  }
  useEffect(
    () => () => {
      generation.current++;
      controls.current?.stop();
      const stream = video.current?.srcObject;
      if (typeof MediaStream !== "undefined" && stream instanceof MediaStream)
        stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  useEffect(() => {
    if (disabled) stop();
  }, [disabled]);
  async function start() {
    if (loading || running || disabled) return;
    stop();
    setError("");
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(
        "카메라 스캔은 HTTPS에서 사용할 수 있어요. 사진에서 QR을 읽거나 휴대폰 기본 카메라로 입장권을 열어주세요.",
      );
      return;
    }
    const current = ++generation.current;
    setLoading(true);
    detected.current = false;
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      if (current !== generation.current || !video.current) return;
      const reader = new BrowserQRCodeReader();
      const next = await reader.decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: "environment" } } },
        video.current,
        (result, _error, scanner) => {
          if (!result || detected.current || current !== generation.current) return;
          detected.current = true;
          scanner.stop();
          setRunning(false);
          setLoading(false);
          callback.current(result.getText());
        },
      );
      if (current !== generation.current || detected.current) next.stop();
      else {
        controls.current = next;
        setRunning(true);
        setLoading(false);
      }
    } catch (cause) {
      if (current === generation.current) {
        stop();
        setError(
          cause instanceof Error && cause.name === "NotAllowedError"
            ? "카메라 권한을 허용하거나 QR 사진을 선택해주세요."
            : "카메라를 열지 못했어요. QR 사진이나 입장 코드를 사용해주세요.",
        );
      }
    }
  }
  async function image(file: File | undefined) {
    if (!file || disabled) return;
    stop();
    setError("");
    setLoading(true);
    const current = ++generation.current,
      source = URL.createObjectURL(file);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const result = await new BrowserQRCodeReader().decodeFromImageUrl(source);
      if (current === generation.current) callback.current(result.getText());
    } catch {
      if (current === generation.current)
        setError("사진에서 QR을 찾지 못했어요. 입장권 전체가 보이는 사진을 선택해주세요.");
    } finally {
      URL.revokeObjectURL(source);
      if (current === generation.current) setLoading(false);
    }
  }
  return (
    <div className="ops-scanner">
      <video
        ref={video}
        muted
        playsInline
        aria-label="QR 카메라 미리보기"
        hidden={!running && !loading}
      />
      <div className="ops-actions">
        <button
          type="button"
          className="participation-primary"
          disabled={disabled || loading}
          onClick={() => (running ? stop() : void start())}
        >
          <Camera size={17} />
          {loading ? "준비 중…" : running ? "카메라 끄기" : "카메라로 QR 읽기"}
        </button>
        <label className="participation-secondary ops-file">
          <ImageIcon size={16} />
          사진에서 QR 읽기
          <input
            type="file"
            accept="image/*"
            disabled={disabled || loading}
            onChange={(event) => {
              void image(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </div>
      {error && (
        <p className="ops-note" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
