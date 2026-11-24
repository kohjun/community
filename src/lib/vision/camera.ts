"use client";

export type CameraFacing = "environment" | "user";

export type CameraErrorCode =
  "unsupported" | "insecure" | "denied" | "not-found" | "busy" | "unknown";

export type CameraStartResult =
  | { ok: true; stream: MediaStream; facing: CameraFacing }
  | { ok: false; code: CameraErrorCode; message: string };

export function cameraAvailable():
  { ok: true } | { ok: false; code: CameraErrorCode; message: string } {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      ok: false,
      code: "unsupported",
      message: "브라우저 환경에서만 카메라를 열 수 있어요.",
    };
  }
  if (
    !window.isSecureContext &&
    location.hostname !== "localhost" &&
    location.hostname !== "127.0.0.1"
  ) {
    return {
      ok: false,
      code: "insecure",
      message: "HTTPS 연결에서만 카메라를 쓸 수 있어요. 보안 연결(https)로 다시 접속해주세요.",
    };
  }
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    return {
      ok: false,
      code: "unsupported",
      message: "이 브라우저에서는 카메라를 쓸 수 없어요. 크롬이나 사파리로 다시 접속해주세요.",
    };
  }
  return { ok: true };
}

export async function startCameraStream(facing: CameraFacing): Promise<CameraStartResult> {
  const check = cameraAvailable();
  if (!check.ok) return check;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 640, max: 1280 },
        height: { ideal: 480, max: 960 },
      },
    });
    return { ok: true, stream, facing };
  } catch (error) {
    // Fallback without ideal facing constraint (e.g., desktop webcams)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
      });
      return { ok: true, stream, facing };
    } catch (fallbackError) {
      const err = fallbackError instanceof Error ? fallbackError : error;
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        return {
          ok: false,
          code: "denied",
          message:
            "카메라 권한이 거부됐어요. 주소창의 자물쇠 아이콘에서 카메라를 허용한 뒤 다시 켜주세요.",
        };
      }
      if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        return {
          ok: false,
          code: "not-found",
          message: "연결된 카메라를 찾지 못했어요. 카메라가 있는 기기로 참여해주세요.",
        };
      }
      if (name === "NotReadableError" || name === "TrackStartError") {
        return {
          ok: false,
          code: "busy",
          message: "다른 앱에서 카메라를 사용 중이에요. 그 앱을 닫고 다시 켜주세요.",
        };
      }
      return {
        ok: false,
        code: "unknown",
        message: "카메라를 열지 못했어요. 잠시 후 다시 켜주세요.",
      };
    }
  }
}

export function stopCameraStream(stream: MediaStream | null | undefined) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Ignore already-stopped track errors.
    }
  }
}

export async function attachStreamToVideo(
  video: HTMLVideoElement,
  stream: MediaStream,
): Promise<void> {
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  video.srcObject = stream;
  await new Promise<void>((resolve) => {
    if (video.readyState >= 2) {
      resolve();
      return;
    }
    const done = () => {
      video.removeEventListener("loadeddata", done);
      resolve();
    };
    video.addEventListener("loadeddata", done, { once: true });
    setTimeout(done, 1500);
  });
  try {
    await video.play();
  } catch {
    // Autoplay may resolve after first gesture on strict mobile browsers.
  }
}
