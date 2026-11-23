"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  CheckCircle2,
  Eye,
  EyeOff,
  Flame,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Sun,
  Timer,
  Trophy,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { GameRoomView } from "@/domain/game-room";
import {
  SNAP_COLOR_BANK,
  SNAP_COLOR_MIN_ACCURACY,
  SNAP_EXPRESSION_LABELS,
  SNAP_PANG_PRESET_META,
  snapPangSlotLabel,
  type SnapExpressionId,
  type SnapMission,
  type SnapPangView,
} from "@/domain/snap-pang";
import { computeColorMatchScore, rgbToHex, sampleCenterRgb } from "@/lib/vision/color-lab";
import {
  attachStreamToVideo,
  startCameraStream,
  stopCameraStream,
  type CameraFacing,
} from "@/lib/vision/camera";
import {
  getFaceLandmarker,
  getObjectDetector,
  NEUTRAL_FACE_TELEMETRY,
  preloadSnapVision,
  runFaceTelemetry,
  runObjectDetection,
  scoreExpressionMatch,
  smileBurstIntensity,
  type DetectedObjectBox,
} from "@/lib/vision/mediapipe";
import { snapSfx } from "@/lib/vision/sfx";
import { SnapPang3dStage, type Snap3dLiveState } from "./snap-pang-3d";
import styles from "./snap-pang-stage.module.css";

type Send = (action: Record<string, unknown>, host?: boolean) => Promise<boolean> | void;

const missionLabel = (mission: SnapMission) =>
  snapPangSlotLabel(
    mission.kind === "face" ? { kind: "face", face: mission.subMode } : { kind: mission.kind },
  );

// Detection tuning: how recent and confident a sighting must be, and how long a face must hold.
const OBJECT_FRESH_MS = 700;
const OBJECT_MATCH_SCORE = 0.32;
const FACE_HOLD_MS = 420;
const FACE_MATCH_SCORE = 0.45;
const TOAST_MS = 3_600;
const FLASH_MS = 1_400;
const SMILE_THRESHOLD = 0.28;

/** Per-round detection progress. Lives in a ref so re-renders and room updates never reset it. */
type RoundProgress = {
  /** When the target object(s) were last in view, and the best detector score then. */
  lastMatchAt: number;
  lastMatchScore: number;
  confidence: number;
  tension: number;
  lastPulseAt: number;
  lastPulseTension: number;
  copyStep: number;
  holdMs: number;
  /** The round goal is met locally (captured, combo done or bomb popped) and must reach the server. */
  done: boolean;
  acked: boolean;
  inFlight: boolean;
  attempts: number;
  lastAttemptAt: number;
};
const freshProgress = (): RoundProgress => ({
  lastMatchAt: -Infinity,
  lastMatchScore: 0,
  confidence: 0,
  tension: 0,
  lastPulseAt: 0,
  lastPulseTension: 0,
  copyStep: 0,
  holdMs: 0,
  done: false,
  acked: false,
  inFlight: false,
  attempts: 0,
  lastAttemptAt: 0,
});

type StageToast = { id: number; eyebrow: string; title: string; detail: string; swatch?: string };
/** Big pass/fail feedback shown over the play area. */
type StageFlash = { id: number; tone: "success" | "fail"; title: string; detail?: string };

/** Maps a detector box (video pixels) onto the object-fit: cover video element, mirrored if needed. */
function toDisplayBox(
  box: DetectedObjectBox,
  video: HTMLVideoElement,
  mirrored: boolean,
): DetectedObjectBox {
  const cw = video.clientWidth || 1,
    ch = video.clientHeight || 1,
    vw = video.videoWidth || cw,
    vh = video.videoHeight || ch;
  const scale = Math.max(cw / vw, ch / vh);
  const dx = (cw - vw * scale) / 2,
    dy = (ch - vh * scale) / 2;
  const width = (box.width * vw * scale) / cw,
    height = (box.height * vh * scale) / ch;
  let x = (dx + box.x * vw * scale) / cw;
  const y = (dy + box.y * vh * scale) / ch;
  if (mirrored) x = 1 - x - width;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return { ...box, x: clamp(x), y: clamp(y), width: clamp(width), height: clamp(height) };
}

function missionToast(
  mission: SnapMission,
  isAttacker: boolean,
  attackerName: string | null,
): Omit<StageToast, "id"> {
  if (mission.kind === "color")
    return {
      eyebrow: "🎨 찾을 색깔",
      title: mission.colorName,
      detail: "이 색깔의 물건을 가운데 원에 맞추고 셔터를 눌러요.",
      swatch: mission.targetHex,
    };
  if (mission.kind === "object")
    return {
      eyebrow: "📦 찾을 물건",
      title: mission.label,
      detail:
        mission.targetCount > 1
          ? `${mission.targetCount}개를 한 화면에 담고 초록 상자가 보이면 셔터를 눌러요.`
          : "물건을 비추고 초록 상자가 보이면 셔터를 눌러요.",
    };
  if (mission.subMode === "smile-bomb")
    return isAttacker
      ? {
          eyebrow: "💣 웃음 참기 · 내가 공격자",
          title: "다른 사람들을 웃겨보세요!",
          detail: mission.attackCard ?? "카드 미션으로 테이블을 웃겨요.",
        }
      : {
          eyebrow: "💣 웃음 참기",
          title: "웃으면 내 폭탄이 터져요!",
          detail: `${attackerName ?? "공격자"}님이 웃기는 동안 무표정을 지키세요.`,
        };
  return {
    eyebrow: "🎭 표정 릴레이",
    title: mission.expressions
      .map((expr) => `${SNAP_EXPRESSION_LABELS[expr].emoji} ${SNAP_EXPRESSION_LABELS[expr].label}`)
      .join(" → "),
    detail: "순서대로 표정을 짓고 잠깐 유지하면 다음으로 넘어가요.",
  };
}

const OBJECT_LABEL_KO: Record<string, string> = {
  cup: "컵",
  "wine glass": "유리잔",
  bottle: "병",
  "cell phone": "휴대폰",
  handbag: "가방",
  backpack: "백팩",
  suitcase: "가방",
  book: "책·메뉴판",
  chair: "의자",
  bowl: "그릇",
  laptop: "노트북",
  person: "사람",
};

const FALLBACK_OBJECT_CHOICES = [
  { id: "cup", label: "☕ 컵·잔" },
  { id: "bottle", label: "🍾 병·음료" },
  { id: "cell phone", label: "📱 휴대폰" },
  { id: "handbag", label: "👜 가방" },
  { id: "book", label: "📖 책·메뉴" },
  { id: "chair", label: "🪑 의자" },
  { id: "bowl", label: "🥣 그릇" },
];

export function SnapPangStage({
  room,
  game,
  busy,
  onAction,
  onRefresh,
}: {
  room: GameRoomView;
  game: SnapPangView;
  busy: boolean;
  onAction: Send;
  onRefresh: () => void;
}) {
  const viewerId = room.viewer.id;
  const me = game.roster.find((p) => p.id === viewerId) ?? null;
  const isPlayer = !!me;
  const mission = game.mission;
  const isSmileBomb = mission?.kind === "face" && mission.subMode === "smile-bomb";
  const isFaceCopy = mission?.kind === "face" && mission.subMode === "face-copy";
  const isAttacker = isSmileBomb && mission?.attackerId === viewerId;

  const [muted, setMuted] = useState(false);
  const [fallbackMode, setFallbackMode] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [facingOverride, setFacingOverride] = useState<CameraFacing | null>(null);
  // Face rounds show the player's own camera; they can swap it for the 3D avatar instead.
  const [faceMasked, setFaceMasked] = useState(false);
  const [modelStatus, setModelStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [lowLight, setLowLight] = useState(false);
  const [toast, setToast] = useState<StageToast | null>(null);
  const [flash, setFlash] = useState<StageFlash | null>(null);

  // Live HUD readouts
  const [sampleHex, setSampleHex] = useState("#94A3B8");
  const [colorAccuracy, setColorAccuracy] = useState(0);
  const [lockProgress, setLockProgress] = useState(0);
  const [detectedBoxes, setDetectedBoxes] = useState<DetectedObjectBox[]>([]);
  const [myTension, setMyTension] = useState(0);
  const [myPopped, setMyPopped] = useState(false);
  const [faceStepIndex, setFaceStepIndex] = useState(0);
  const [faceStepProgress, setFaceStepProgress] = useState(0);
  const [faceDetected, setFaceDetected] = useState(false);
  // Live "is it working?" signals for the in-camera HUD.
  const [objectReady, setObjectReady] = useState(false);
  const [faceMatch, setFaceMatch] = useState(0);
  const [smiling, setSmiling] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Fallback mini-game states
  const [rouletteIndex, setRouletteIndex] = useState(0);
  const [fallbackObjectClicks, setFallbackObjectClicks] = useState(0);
  const [fallbackFaceClicks, setFallbackFaceClicks] = useState(0);

  // Server-synced countdown
  const clockOffset = useMemo(() => game.serverNow - Date.now(), [game.serverNow]);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const progressRef = useRef<RoundProgress>(freshProgress());
  const liveRef = useRef<Snap3dLiveState>({
    sampleHex: "#94A3B8",
    colorAccuracy: 0,
    lockProgress: 0,
    tension: 0,
    popped: false,
    face: NEUTRAL_FACE_TELEMETRY,
    burstCounter: 0,
    burstKind: "paint",
    burstColor: "#0A84FE",
  });

  // Detection loops read the latest props through refs, so a parent re-render (a new `onAction`
  // or a fresh `mission` object from a room update) never restarts them mid-round.
  const latest = useRef({ onAction, mission, runId: game.runId, round: game.round, color: "" });
  useEffect(() => {
    latest.current = {
      onAction,
      mission,
      runId: game.runId,
      round: game.round,
      color: me?.color ?? "#0A84FE",
    };
  });

  const missionId = mission?.id ?? null;
  const missionKind = mission?.kind ?? null;
  const faceSubMode = mission?.kind === "face" ? mission.subMode : null;
  const hasSubmitted = !!game.mySubmission;
  const desiredFacing: CameraFacing =
    facingOverride ?? (mission?.kind === "face" ? "user" : "environment");
  const mirrored = desiredFacing === "user";
  const needsCamera =
    isPlayer &&
    !fallbackMode &&
    !isAttacker &&
    (game.stage === "briefing" || game.stage === "active") &&
    !hasSubmitted;
  // The live camera is the play area; masked face rounds show the 3D avatar there instead.
  const cameraFront = needsCamera && !(mission?.kind === "face" && faceMasked);
  // Players on camera get the target, live feedback and shutter drawn over the play area.
  const playHud = needsCamera && !!mission;
  const attackerName =
    isSmileBomb && mission.attackerId
      ? (game.roster.find((p) => p.id === mission.attackerId)?.nickname ?? "공격자")
      : null;

  const showToast = useCallback(
    (next: Omit<StageToast, "id">) => setToast({ ...next, id: Date.now() }),
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  const showFlash = useCallback(
    (next: Omit<StageFlash, "id">) => setFlash({ ...next, id: Date.now() }),
    [],
  );
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  // Announce the target as a toast once per round, when play starts.
  const announcedRef = useRef("");
  useEffect(() => {
    if (game.stage !== "active" || !mission) return;
    const key = `${game.runId ?? "none"}:${game.round}`;
    if (announcedRef.current === key) return;
    announcedRef.current = key;
    showToast(missionToast(mission, isAttacker, attackerName));
  }, [game.stage, game.runId, game.round, mission, isAttacker, attackerName, showToast]);

  // Gently preload only the on-device models this mode will use.
  useEffect(() => {
    const preset = game.settings.preset;
    preloadSnapVision({
      object: preset === "object" || preset === "random",
      face: SNAP_PANG_PRESET_META[preset]?.usesFace ?? true,
    });
  }, [game.settings.preset]);

  // Reset per-round local state
  useEffect(() => {
    progressRef.current = freshProgress();
    setObjectReady(false);
    setFaceMatch(0);
    setSmiling(false);
    setLockProgress(0);
    setDetectedBoxes([]);
    setMyTension(0);
    setMyPopped(false);
    setFaceStepIndex(0);
    setFaceStepProgress(0);
    setFallbackObjectClicks(0);
    setFallbackFaceClicks(0);
    setSubmitting(false);
    setFacingOverride(null);
    liveRef.current.lockProgress = 0;
    liveRef.current.tension = 0;
    liveRef.current.popped = false;
    liveRef.current.face = NEUTRAL_FACE_TELEMETRY;
  }, [game.runId, game.round]);

  // At each reveal, flash the player's own pass/fail so it is noticed without reading the list.
  const revealFlashRef = useRef("");
  useEffect(() => {
    if (game.stage !== "reveal" || !game.lastResult || !isPlayer) return;
    const key = `${game.runId ?? "none"}:${game.lastResult.round}`;
    if (revealFlashRef.current === key) return;
    revealFlashRef.current = key;
    const mine = game.lastResult.entries.find((entry) => entry.playerId === viewerId);
    if (!mine) return;
    showFlash(
      mine.points > 0
        ? { tone: "success", title: `통과! +${mine.points}점`, detail: mine.detail }
        : { tone: "fail", title: "이번 라운드는 실패", detail: mine.detail },
    );
  }, [game.stage, game.runId, game.lastResult, isPlayer, viewerId, showFlash]);

  // Play victory fanfare when reaching 3D podium
  useEffect(() => {
    if (game.stage === "result") snapSfx.play("fanfare");
  }, [game.stage]);

  // Countdown tick + auto-refresh when server timer expires
  useEffect(() => {
    if (game.paused || game.endsAt === null) {
      setRemainingSec(null);
      return;
    }
    let refreshed = false;
    const update = () => {
      const serverNow = Date.now() + clockOffset;
      const ms = Math.max(0, game.endsAt! - serverNow);
      const sec = Math.ceil(ms / 1000);
      setRemainingSec(sec);
      if (ms === 0 && !refreshed) {
        refreshed = true;
        onRefresh();
      }
    };
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [game.endsAt, game.paused, clockOffset, onRefresh]);

  // Manage camera stream lifecycle
  useEffect(() => {
    if (!needsCamera) {
      stopCameraStream(streamRef.current);
      streamRef.current = null;
      setCameraReady(false);
      return;
    }
    let cancelled = false;
    setCameraError("");
    setCameraReady(false);
    void startCameraStream(desiredFacing).then(async (res) => {
      if (cancelled) {
        if (res.ok) stopCameraStream(res.stream);
        return;
      }
      if (!res.ok) {
        setCameraError(res.message);
        setFallbackMode(true);
        return;
      }
      stopCameraStream(streamRef.current);
      streamRef.current = res.stream;
      if (videoRef.current) {
        await attachStreamToVideo(videoRef.current, res.stream);
      }
      if (!cancelled) setCameraReady(true);
    });
    return () => {
      cancelled = true;
      stopCameraStream(streamRef.current);
      streamRef.current = null;
    };
  }, [needsCamera, desiredFacing]);

  const trigger3dBurst = useCallback((kind: Snap3dLiveState["burstKind"], color: string) => {
    liveRef.current.burstKind = kind;
    liveRef.current.burstColor = color;
    liveRef.current.burstCounter += 1;
  }, []);

  /**
   * Sends the round's result until the server accepts it. The room drops an action while another
   * is in flight (e.g. a tension pulse), so a single fire-and-forget send could be lost for good.
   */
  const deliverResult = useCallback((payload: Record<string, unknown>) => {
    const progress = progressRef.current;
    const now = performance.now();
    if (progress.acked || progress.inFlight || progress.attempts >= 8) return;
    if (now - progress.lastAttemptAt < 650) return;
    progress.inFlight = true;
    progress.attempts += 1;
    progress.lastAttemptAt = now;
    void Promise.resolve(latest.current.onAction(payload))
      .then((ok) => {
        if (ok !== false) progress.acked = true;
      })
      .catch(() => {})
      .finally(() => {
        progress.inFlight = false;
      });
  }, []);

  // Color round: live center sampler (pure Canvas + CIE Lab, no model download)
  useEffect(() => {
    if (
      game.stage !== "active" ||
      missionKind !== "color" ||
      !cameraReady ||
      fallbackMode ||
      hasSubmitted
    )
      return;
    if (!sampleCanvasRef.current) {
      const canvas = document.createElement("canvas");
      canvas.width = 96;
      canvas.height = 96;
      sampleCanvasRef.current = canvas;
    }
    const ctx = sampleCanvasRef.current.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const timer = setInterval(() => {
      const video = videoRef.current;
      const current = latest.current.mission;
      if (!video || video.readyState < 2 || video.videoWidth <= 0 || current?.kind !== "color")
        return;
      ctx.drawImage(video, 0, 0, 96, 96);
      const pixels = ctx.getImageData(0, 0, 96, 96).data;
      const { rgb, luma } = sampleCenterRgb(pixels, 96, 96, 0.16);
      const hex = rgbToHex(rgb);
      const accuracy = computeColorMatchScore(current.targetHex, hex);
      setSampleHex(hex);
      setColorAccuracy(accuracy);
      setLowLight(luma < 36);
      liveRef.current.sampleHex = hex;
      liveRef.current.colorAccuracy = accuracy;
    }, 120);
    return () => clearInterval(timer);
  }, [game.stage, missionId, missionKind, cameraReady, fallbackMode, hasSubmitted]);

  // Object round: on-device ObjectDetector loop (~9fps)
  useEffect(() => {
    if (
      game.stage !== "active" ||
      missionKind !== "object" ||
      !cameraReady ||
      fallbackMode ||
      hasSubmitted ||
      !isPlayer
    )
      return;

    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    setModelStatus("loading");

    void getObjectDetector()
      .then((detector) => {
        if (!alive) return;
        setModelStatus("ready");
        timer = setInterval(() => {
          const { mission: current, runId, round } = latest.current;
          const progress = progressRef.current;
          if (current?.kind !== "object" || !runId) return;
          const submit = () =>
            deliverResult({
              action: "snap-object",
              runId,
              round,
              confidence: progress.confidence,
              fallback: false,
            });
          if (progress.done) {
            submit();
            return;
          }
          const video = videoRef.current;
          if (!video || video.readyState < 2) return;
          const now = performance.now();
          const boxes = runObjectDetection(detector, video, now);
          const matching = boxes.filter(
            (b) => current.cocoLabels.includes(b.label) && b.score >= OBJECT_MATCH_SCORE,
          );
          setDetectedBoxes(
            (matching.length > 0 ? matching : boxes.slice(0, 2)).map((box) =>
              toDisplayBox(box, video, mirrored),
            ),
          );

          // Capture is manual (the in-camera shutter); the loop only reports whether it would hit.
          if (matching.length >= current.targetCount) {
            progress.lastMatchAt = now;
            progress.lastMatchScore = Math.max(...matching.map((m) => m.score));
          }
          const ready = now - progress.lastMatchAt <= OBJECT_FRESH_MS;
          setObjectReady(ready);
          liveRef.current.lockProgress = ready ? 1 : 0;
        }, 110);
      })
      .catch(() => {
        if (!alive) return;
        setModelStatus("error");
        setFallbackMode(true);
      });

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [
    game.stage,
    missionId,
    missionKind,
    cameraReady,
    fallbackMode,
    hasSubmitted,
    isPlayer,
    mirrored,
    deliverResult,
  ]);

  // Face rounds: on-device FaceLandmarker loop (~11fps) for 웃음 참기 and 표정 릴레이
  useEffect(() => {
    if (
      game.stage !== "active" ||
      missionKind !== "face" ||
      isAttacker ||
      !cameraReady ||
      fallbackMode ||
      hasSubmitted ||
      !isPlayer
    )
      return;

    let alive = true;
    let lastTick = performance.now();
    let timer: ReturnType<typeof setInterval> | null = null;
    setModelStatus("loading");

    void getFaceLandmarker()
      .then((landmarker) => {
        if (!alive) return;
        setModelStatus("ready");
        timer = setInterval(() => {
          const { mission: current, runId, round, color } = latest.current;
          const progress = progressRef.current;
          if (current?.kind !== "face" || !runId) return;

          if (current.subMode === "smile-bomb" && progress.done) {
            deliverResult({
              action: "snap-tension",
              runId,
              round,
              tension: 100,
              popped: true,
              fallback: false,
            });
            return;
          }
          if (current.subMode === "face-copy" && progress.done) {
            deliverResult({ action: "snap-face-copy", runId, round, fallback: false });
            return;
          }

          const video = videoRef.current;
          if (!video || video.readyState < 2) return;
          const now = performance.now();
          const dtMs = Math.min(250, now - lastTick);
          lastTick = now;

          const telemetry = runFaceTelemetry(landmarker, video, now);
          liveRef.current.face = telemetry;
          setFaceDetected(telemetry.faceDetected);

          if (current.subMode === "smile-bomb") {
            const intensity = smileBurstIntensity(telemetry);
            setSmiling(intensity > SMILE_THRESHOLD);
            progress.tension =
              intensity > SMILE_THRESHOLD
                ? Math.min(100, progress.tension + (intensity - 0.23) * 0.145 * dtMs)
                : Math.max(0, progress.tension - 0.008 * dtMs);
            const rounded = Math.round(progress.tension);
            setMyTension(rounded);
            liveRef.current.tension = rounded;

            if (rounded >= 100) {
              progress.done = true;
              setMyPopped(true);
              liveRef.current.popped = true;
              snapSfx.play("pop");
              trigger3dBurst("pop", color);
              showFlash({
                tone: "fail",
                title: "💥 팡! 웃어버렸어요",
                detail: "이번 라운드는 실패예요. 이제 다른 사람을 웃겨보세요!",
              });
              deliverResult({
                action: "snap-tension",
                runId,
                round,
                tension: 100,
                popped: true,
                fallback: false,
              });
              return;
            }
            // Best-effort live gauge for everyone's bomb grid; a dropped pulse is harmless.
            if (
              now - progress.lastPulseAt >= 1400 &&
              Math.abs(rounded - progress.lastPulseTension) >= 12
            ) {
              progress.lastPulseAt = now;
              progress.lastPulseTension = rounded;
              void latest.current.onAction({
                action: "snap-tension",
                runId,
                round,
                tension: rounded,
                popped: false,
                fallback: false,
              });
            }
            return;
          }

          // 표정 릴레이: hold each expression briefly, in order.
          const target = current.expressions[progress.copyStep];
          if (!target) return;
          const match = scoreExpressionMatch(telemetry, target);
          setFaceMatch(Math.round(match * 20) / 20);
          progress.holdMs =
            match >= FACE_MATCH_SCORE
              ? Math.min(FACE_HOLD_MS, progress.holdMs + dtMs)
              : Math.max(0, progress.holdMs - dtMs * 0.65);
          setFaceStepProgress(Math.min(1, progress.holdMs / FACE_HOLD_MS));
          if (progress.holdMs < FACE_HOLD_MS) return;

          progress.holdMs = 0;
          progress.copyStep += 1;
          setFaceStepIndex(progress.copyStep);
          setFaceStepProgress(0);
          const passed = SNAP_EXPRESSION_LABELS[target];
          const next = current.expressions[progress.copyStep];
          if (next) {
            snapSfx.play("lockTick");
            const info = SNAP_EXPRESSION_LABELS[next];
            showFlash({
              tone: "success",
              title: `통과! ${passed.emoji} ${passed.label}`,
              detail: `다음 표정: ${info.emoji} ${info.label}`,
            });
            return;
          }
          progress.done = true;
          showFlash({
            tone: "success",
            title: "🎉 표정 릴레이 성공!",
            detail: "모든 표정을 통과했어요.",
          });
          snapSfx.play("capture");
          trigger3dBurst("capture", color);
          setSubmitting(true);
          deliverResult({ action: "snap-face-copy", runId, round, fallback: false });
        }, 90);
      })
      .catch(() => {
        if (!alive) return;
        setModelStatus("error");
        setFallbackMode(true);
      });

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [
    game.stage,
    missionId,
    missionKind,
    faceSubMode,
    isAttacker,
    cameraReady,
    fallbackMode,
    hasSubmitted,
    isPlayer,
    deliverResult,
    trigger3dBurst,
    showFlash,
  ]);

  // Fallback color roulette colors & spinner
  const rouletteColors = useMemo(() => {
    if (mission?.kind !== "color") return [];
    const distractors = SNAP_COLOR_BANK.filter((c) => c.targetHex !== mission.targetHex)
      .slice(0, 5)
      .map((c) => c.targetHex);
    return [
      distractors[0] ?? "#EF4444",
      mission.targetHex,
      distractors[1] ?? "#FACC15",
      distractors[2] ?? "#14B8A6",
      distractors[3] ?? "#8B5CF6",
      distractors[4] ?? "#F97316",
    ];
  }, [mission]);

  useEffect(() => {
    if (!fallbackMode || game.stage !== "active" || mission?.kind !== "color" || game.mySubmission)
      return;
    const timer = setInterval(() => {
      setRouletteIndex((idx) => {
        const next = (idx + 1) % Math.max(1, rouletteColors.length);
        const hex = rouletteColors[next] ?? "#0A84FE";
        liveRef.current.sampleHex = hex;
        liveRef.current.colorAccuracy = computeColorMatchScore(mission.targetHex, hex);
        return next;
      });
    }, 170);
    return () => clearInterval(timer);
  }, [fallbackMode, game.stage, mission, game.mySubmission, rouletteColors]);

  async function submitColorShot(hex: string, isFallback: boolean) {
    if (!game.runId || submitting || game.mySubmission) return;
    setSubmitting(true);
    snapSfx.play("shutter");
    trigger3dBurst("paint", hex);
    const accuracy = mission?.kind === "color" ? computeColorMatchScore(mission.targetHex, hex) : 0;
    const ok = await onAction({
      action: "snap-color",
      runId: game.runId,
      round: game.round,
      hex,
      fallback: isFallback,
    });
    if (ok === false) {
      setSubmitting(false);
      showFlash({
        tone: "fail",
        title: "제출하지 못했어요",
        detail: "셔터를 한 번 더 눌러주세요.",
      });
      return;
    }
    showFlash(
      accuracy >= SNAP_COLOR_MIN_ACCURACY
        ? {
            tone: "success",
            title: `찰칵! 일치도 ${accuracy}%`,
            detail: accuracy >= 75 ? "아주 비슷해요!" : "점수를 받을 수 있어요.",
          }
        : {
            tone: "fail",
            title: `색이 너무 달라요 (${accuracy}%)`,
            detail: `일치도 ${SNAP_COLOR_MIN_ACCURACY}% 이상이어야 점수를 받아요.`,
          },
    );
  }

  /** Object shutter: only counts when the target is in view right now. */
  function captureObject() {
    if (mission?.kind !== "object" || !game.runId || hasSubmitted) return;
    const progress = progressRef.current;
    if (progress.done) return;
    if (performance.now() - progress.lastMatchAt > OBJECT_FRESH_MS) {
      snapSfx.play("countdown");
      showFlash({
        tone: "fail",
        title: "아직 안 보여요",
        detail: `${mission.label}${mission.targetCount > 1 ? ` ${mission.targetCount}개` : ""}를 화면 안에 담고 다시 찍어요.`,
      });
      return;
    }
    progress.done = true;
    progress.confidence = Number(Math.max(0.5, progress.lastMatchScore).toFixed(2));
    snapSfx.play("capture");
    trigger3dBurst("capture", me?.color ?? "#0A84FE");
    setSubmitting(true);
    showFlash({ tone: "success", title: "찰칵! 찾았어요", detail: mission.label });
    deliverResult({
      action: "snap-object",
      runId: game.runId,
      round: game.round,
      confidence: progress.confidence,
      fallback: false,
    });
  }

  async function handleFallbackObjectTap(choiceId: string) {
    if (!game.runId || mission?.kind !== "object" || submitting || game.mySubmission) return;
    if (!mission.cocoLabels.includes(choiceId)) {
      snapSfx.play("countdown");
      return;
    }
    const nextClicks = fallbackObjectClicks + 1;
    setFallbackObjectClicks(nextClicks);
    const needed = mission.targetCount + 1;
    const prog = Math.min(1, nextClicks / needed);
    setLockProgress(prog);
    liveRef.current.lockProgress = prog;
    if (nextClicks < needed) {
      snapSfx.play("lockTick");
      return;
    }
    setSubmitting(true);
    snapSfx.play("capture");
    trigger3dBurst("capture", me?.color ?? "#0A84FE");
    const ok = await onAction({
      action: "snap-object",
      runId: game.runId,
      round: game.round,
      confidence: 0.85,
      fallback: true,
    });
    if (ok === false) setSubmitting(false);
  }

  async function handleFallbackFaceTap(expr: SnapExpressionId) {
    if (!game.runId || !isFaceCopy || submitting || game.mySubmission) return;
    const expected = mission.expressions[fallbackFaceClicks];
    if (expr !== expected) {
      snapSfx.play("countdown");
      return;
    }
    const nextStep = fallbackFaceClicks + 1;
    setFallbackFaceClicks(nextStep);
    setFaceStepIndex(nextStep);
    // Briefly show matching expression on the 3D avatar!
    liveRef.current.face = {
      ...NEUTRAL_FACE_TELEMETRY,
      faceDetected: true,
      jawOpen: expr === "surprise" ? 0.9 : 0,
      smile: expr === "happy" ? 0.95 : 0,
      winkLeft: expr === "wink" ? 0.95 : 0,
      browDown: expr === "angry" ? 0.9 : 0,
      pucker: expr === "pucker" ? 0.9 : 0,
    };
    if (nextStep < mission.expressions.length) {
      snapSfx.play("lockTick");
      return;
    }
    setSubmitting(true);
    snapSfx.play("capture");
    trigger3dBurst("capture", me?.color ?? "#0A84FE");
    const ok = await onAction({
      action: "snap-face-copy",
      runId: game.runId,
      round: game.round,
      fallback: true,
    });
    if (ok === false) setSubmitting(false);
  }

  async function handleFallbackSmilePop() {
    if (!game.runId || !isSmileBomb || myPopped) return;
    setMyPopped(true);
    setMyTension(100);
    liveRef.current.tension = 100;
    liveRef.current.popped = true;
    snapSfx.play("pop");
    trigger3dBurst("pop", me?.color ?? "#EF4444");
    const ok = await onAction({
      action: "snap-tension",
      runId: game.runId,
      round: game.round,
      tension: 100,
      popped: true,
      fallback: true,
    });
    // Not recorded (e.g. another send was in flight): let the player press it again.
    if (ok === false) {
      setMyPopped(false);
      liveRef.current.popped = false;
    }
  }

  function hostControl(command: "next" | "pause" | "resume") {
    void onAction(
      {
        action: "snap-control",
        revision: room.revision,
        phaseId: game.phaseId,
        command,
      },
      true,
    );
  }

  return (
    <section className={styles.stage} aria-label="스냅 팡 3D 게임 무대">
      {/* Top Status Bar */}
      <div className={styles.topBar}>
        <div className={styles.badges}>
          <span className={styles.roundBadge}>
            <Sparkles size={13} />
            {game.stage === "result"
              ? "최종 3D 시상대"
              : `ROUND ${game.round} / ${game.totalRounds}`}
          </span>
          {mission && game.stage !== "result" && (
            <span className={styles.kindBadge}>{missionLabel(mission)}</span>
          )}
          <span className={styles.kindBadge}>
            {SNAP_PANG_PRESET_META[game.settings.preset]?.title ?? "🎲 랜덤 모드"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {remainingSec !== null && (
            <span className={styles.timerPill} data-urgent={remainingSec <= 5}>
              <Timer size={14} />
              {game.paused ? "일시정지" : `${remainingSec}초`}
            </span>
          )}
          <button
            type="button"
            className={styles.audioToggle}
            aria-label={muted ? "효과음 켜기" : "효과음 끄기"}
            onClick={() => {
              const next = !muted;
              setMuted(next);
              snapSfx.muted = next;
            }}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        </div>
      </div>

      {/* Round target toast: what to find right now */}
      {toast && (
        <div key={toast.id} className={styles.toast} role="status" aria-live="polite">
          {toast.swatch && (
            <span className={styles.toastSwatch} style={{ background: toast.swatch }} />
          )}
          <span className={styles.toastBody}>
            <small>{toast.eyebrow}</small>
            <strong>{toast.title}</strong>
            <span>{toast.detail}</span>
          </span>
        </div>
      )}

      {/* Main play area: during camera rounds the live camera IS the play area, with the target,
          live feedback and the shutter drawn on top of it. Otherwise the 3D stage fills it. */}
      <div className={styles.viewport} data-camera={needsCamera}>
        {!cameraFront && (
          <div className={styles.sceneLayer}>
            <SnapPang3dStage
              stage={game.stage}
              mission={mission}
              roster={game.roster}
              lastResult={game.lastResult}
              avatarColor={me?.color ?? "#0A84FE"}
              liveRef={liveRef}
            />
          </div>
        )}

        {needsCamera && (
          <div className={styles.cameraLayer} data-front={cameraFront}>
            <video
              ref={videoRef}
              className={styles.cameraVideo}
              data-mirror={mirrored}
              muted
              playsInline
              autoPlay
            />
            {!cameraReady && (
              <span className={styles.cameraLoading} role="status">
                <Camera size={18} /> 카메라를 켜고 있어요…
              </span>
            )}
            {mission?.kind === "color" && (
              <div className={styles.reticle}>
                <span className={styles.reticleRing} style={{ borderColor: sampleHex }} />
              </div>
            )}
            {mission?.kind === "object" && (
              <div className={styles.bboxLayer}>
                {detectedBoxes.map((box, idx) => (
                  <span
                    key={`${box.label}-${idx}`}
                    className={styles.bbox}
                    data-match={mission.cocoLabels.includes(box.label)}
                    style={{
                      left: `${box.x * 100}%`,
                      top: `${box.y * 100}%`,
                      width: `${box.width * 100}%`,
                      height: `${box.height * 100}%`,
                    }}
                  >
                    <span className={styles.bboxLabel}>
                      {OBJECT_LABEL_KO[box.label] ?? box.label} {Math.round(box.score * 100)}%
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {playHud && mission && (
          <div className={styles.playHud}>
            <div className={styles.hudTop}>
              <button
                type="button"
                className={styles.hudTarget}
                aria-label="이번 라운드 목표 다시 보기"
                onClick={() => showToast(missionToast(mission, isAttacker, attackerName))}
              >
                {mission.kind === "color" && (
                  <>
                    <span className={styles.hudSwatch} style={{ background: mission.targetHex }} />
                    <span className={styles.hudTargetText}>
                      <small>찾을 색깔</small>
                      <strong>{mission.colorName}</strong>
                    </span>
                  </>
                )}
                {mission.kind === "object" && (
                  <>
                    <span className={styles.hudEmoji} aria-hidden="true">
                      📦
                    </span>
                    <span className={styles.hudTargetText}>
                      <small>
                        찾을 물건{mission.targetCount > 1 ? ` · ${mission.targetCount}개 함께` : ""}
                      </small>
                      <strong>{mission.label}</strong>
                    </span>
                  </>
                )}
                {isSmileBomb && (
                  <>
                    <span className={styles.hudEmoji} aria-hidden="true">
                      💣
                    </span>
                    <span className={styles.hudTargetText}>
                      <small>웃음 참기 · 공격자 {attackerName}</small>
                      <strong>웃으면 폭탄이 터져요</strong>
                    </span>
                  </>
                )}
                {isFaceCopy && (
                  <>
                    <span className={styles.hudEmoji} aria-hidden="true">
                      🎭
                    </span>
                    <span className={styles.hudTargetText}>
                      <small>
                        표정 릴레이 {Math.min(faceStepIndex + 1, mission.expressions.length)} /{" "}
                        {mission.expressions.length}
                      </small>
                      <strong className={styles.hudSteps}>
                        {mission.expressions.map((expr, idx) => (
                          <span
                            key={`${expr}-${idx}`}
                            data-done={idx < faceStepIndex}
                            data-active={idx === faceStepIndex}
                          >
                            {idx < faceStepIndex ? "✓" : SNAP_EXPRESSION_LABELS[expr].emoji}
                          </span>
                        ))}
                      </strong>
                    </span>
                  </>
                )}
              </button>
              {mission.kind === "face" && (
                <button
                  type="button"
                  className={styles.hudRound}
                  aria-pressed={faceMasked}
                  aria-label={faceMasked ? "내 얼굴 다시 보기" : "내 얼굴을 3D 아바타로 가리기"}
                  title={faceMasked ? "얼굴 보기" : "얼굴 가리기"}
                  onClick={() => setFaceMasked((v) => !v)}
                >
                  {faceMasked ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
              )}
            </div>

            {game.stage === "briefing" && (
              <div className={styles.hudCountdown} role="status">
                <small>곧 시작해요</small>
                <strong>{remainingSec ?? ""}</strong>
              </div>
            )}

            {game.stage === "active" && mission.kind === "color" && (
              <div className={styles.hudBottom}>
                <div
                  className={styles.hudReadout}
                  data-state={
                    colorAccuracy >= 75
                      ? "good"
                      : colorAccuracy >= SNAP_COLOR_MIN_ACCURACY
                        ? "close"
                        : "bad"
                  }
                >
                  <span className={styles.hudSwatchSmall} style={{ background: sampleHex }} />
                  <span>
                    <strong>일치도 {colorAccuracy}%</strong>
                    <small>
                      {colorAccuracy >= 75
                        ? "아주 비슷해요! 지금 찍으세요"
                        : colorAccuracy >= SNAP_COLOR_MIN_ACCURACY
                          ? "점수는 받아요 · 더 비슷한 색을 찾아도 좋아요"
                          : "가운데 원에 같은 색 물건을 맞춰요"}
                    </small>
                  </span>
                </div>
                <div className={styles.hudControls}>
                  <span />
                  <button
                    type="button"
                    className={styles.hudShutter}
                    data-ready={colorAccuracy >= SNAP_COLOR_MIN_ACCURACY}
                    aria-label="이 색으로 찍어서 제출"
                    disabled={!cameraReady || submitting || busy}
                    onClick={() => void submitColorShot(sampleHex, false)}
                  >
                    <Camera size={28} />
                  </button>
                  <button
                    type="button"
                    className={styles.hudRound}
                    aria-label="카메라 전환"
                    onClick={() =>
                      setFacingOverride((f) => (f === "user" ? "environment" : "user"))
                    }
                  >
                    <RefreshCw size={18} />
                  </button>
                </div>
              </div>
            )}

            {game.stage === "active" && mission.kind === "object" && (
              <div className={styles.hudBottom}>
                <div className={styles.hudReadout} data-state={objectReady ? "good" : "bad"}>
                  <span className={styles.hudStateIcon} aria-hidden="true">
                    {objectReady ? "✓" : "🔍"}
                  </span>
                  <span>
                    <strong>
                      {modelStatus === "loading"
                        ? "물건 인식 준비 중…"
                        : objectReady
                          ? `${mission.label} 인식됐어요!`
                          : "아직 안 보여요"}
                    </strong>
                    <small>
                      {objectReady
                        ? "지금 셔터를 누르면 찍혀요"
                        : "물건을 화면 안에 담으면 초록 상자가 생겨요"}
                    </small>
                  </span>
                </div>
                <div className={styles.hudControls}>
                  <span />
                  <button
                    type="button"
                    className={styles.hudShutter}
                    data-ready={objectReady}
                    aria-label="이 물건 찍어서 제출"
                    disabled={!cameraReady || submitting || modelStatus === "loading"}
                    onClick={captureObject}
                  >
                    <Camera size={28} />
                  </button>
                  <button
                    type="button"
                    className={styles.hudRound}
                    aria-label="카메라 전환"
                    onClick={() =>
                      setFacingOverride((f) => (f === "user" ? "environment" : "user"))
                    }
                  >
                    <RefreshCw size={18} />
                  </button>
                </div>
              </div>
            )}

            {game.stage === "active" && isSmileBomb && (
              <div className={styles.hudBottom}>
                <div
                  className={styles.hudReadout}
                  data-state={myPopped ? "bad" : !faceDetected ? "warn" : smiling ? "bad" : "good"}
                >
                  <span className={styles.hudStateIcon} aria-hidden="true">
                    {myPopped ? "💥" : !faceDetected ? "👀" : smiling ? "😆" : "😐"}
                  </span>
                  <span>
                    <strong>
                      {myPopped
                        ? "실패 · 폭탄이 터졌어요"
                        : modelStatus === "loading"
                          ? "표정 인식 준비 중…"
                          : !faceDetected
                            ? "얼굴이 안 보여요"
                            : smiling
                              ? "웃음 감지! 참으세요"
                              : "잘 참고 있어요"}
                    </strong>
                    <small>폭탄 {myTension}%</small>
                  </span>
                </div>
                <div className={styles.hudMeter} data-danger={myTension >= 50}>
                  <span style={{ width: `${myTension}%` }} />
                </div>
              </div>
            )}

            {game.stage === "active" && isFaceCopy && mission.expressions[faceStepIndex] && (
              <div className={styles.hudBottom}>
                <div className={styles.hudExpression}>
                  <span aria-hidden="true">
                    {SNAP_EXPRESSION_LABELS[mission.expressions[faceStepIndex]!].emoji}
                  </span>
                  <span>
                    <strong>
                      {SNAP_EXPRESSION_LABELS[mission.expressions[faceStepIndex]!].label}
                    </strong>
                    <small>{SNAP_EXPRESSION_LABELS[mission.expressions[faceStepIndex]!].cue}</small>
                  </span>
                </div>
                <div
                  className={styles.hudReadout}
                  data-state={
                    !faceDetected ? "warn" : faceMatch >= FACE_MATCH_SCORE ? "good" : "bad"
                  }
                >
                  <span className={styles.hudStateIcon} aria-hidden="true">
                    {!faceDetected ? "👀" : faceMatch >= FACE_MATCH_SCORE ? "✓" : "✗"}
                  </span>
                  <span>
                    <strong>
                      {modelStatus === "loading"
                        ? "표정 인식 준비 중…"
                        : !faceDetected
                          ? "얼굴이 안 보여요"
                          : faceMatch >= FACE_MATCH_SCORE
                            ? "인식됐어요! 그대로 유지"
                            : "아직 아니에요"}
                    </strong>
                    <small>일치 {Math.round(faceMatch * 100)}%</small>
                  </span>
                </div>
                <div className={styles.hudMeter} data-success={faceStepProgress > 0}>
                  <span style={{ width: `${Math.round(faceStepProgress * 100)}%` }} />
                </div>
              </div>
            )}
          </div>
        )}

        {flash && (
          <div key={flash.id} className={styles.flash} data-tone={flash.tone} role="status">
            <strong>{flash.title}</strong>
            {flash.detail && <span>{flash.detail}</span>}
          </div>
        )}

        {/* Spectators, attackers and fallback players keep the simple chip and briefing card. */}
        {!playHud && mission && game.stage !== "result" && (
          <div className={styles.hudChipRow}>
            <button
              type="button"
              className={styles.missionChip}
              aria-label="이번 라운드 목표 다시 보기"
              onClick={() => showToast(missionToast(mission, isAttacker, attackerName))}
            >
              {mission.kind === "color" && (
                <>
                  <span className={styles.swatchDot} style={{ background: mission.targetHex }} />
                  <span>색깔: {mission.colorName}</span>
                </>
              )}
              {mission.kind === "object" && <span>📦 물건: {mission.label}</span>}
              {mission.kind === "face" && <span>{missionLabel(mission)}</span>}
            </button>
          </div>
        )}

        {!playHud && game.stage === "briefing" && mission && (
          <div className={styles.briefOverlay}>
            <div className={styles.briefCard}>
              <span className={styles.roundBadge}>
                ROUND {game.round} · {missionLabel(mission)}
              </span>
              {mission.kind === "color" && (
                <span
                  className={styles.briefSwatch}
                  style={{ background: mission.targetHex }}
                  aria-hidden="true"
                />
              )}
              <h3>
                {mission.kind === "color"
                  ? `${mission.colorName} 색깔을 찾아요`
                  : mission.kind === "object"
                    ? `${mission.label} 찾기`
                    : mission.subMode === "smile-bomb"
                      ? isAttacker
                        ? "내가 공격자! 웃겨보세요"
                        : "웃으면 폭탄이 터져요"
                      : "표정 릴레이"}
              </h3>
              <p>
                {mission.kind === "color"
                  ? mission.prompt
                  : mission.kind === "object"
                    ? mission.hint
                    : mission.prompt}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Privacy reassurance & camera status */}
      {isPlayer && game.stage === "active" && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            fontSize: 12,
            color: "#64748b",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <ShieldCheck size={14} color="#0A84FE" />
            카메라 분석은 내 기기 안에서만 실행돼요 (서버 전송 없음)
          </span>
          {!isAttacker && (
            <button
              type="button"
              className={styles.secondaryBtn}
              style={{ fontSize: 12 }}
              onClick={() => setFallbackMode((v) => !v)}
            >
              {fallbackMode ? <Camera size={13} /> : <CameraOff size={13} />}
              {fallbackMode ? "카메라 모드 켜기" : "카메라 없이 대체 모드"}
            </button>
          )}
        </div>
      )}

      {cameraError && (
        <div className={styles.lowLightWarn} role="status">
          <CameraOff size={14} />
          <span>{cameraError}</span>
        </div>
      )}

      {lowLight && mission?.kind === "color" && game.stage === "active" && !fallbackMode && (
        <div className={styles.lowLightWarn} role="status">
          <Sun size={14} />
          <span>주변이 어두워 색 인식 정확도가 낮아질 수 있어요. 밝은 쪽으로 비춰보세요!</span>
        </div>
      )}

      {/* ACTIVE PLAY PANEL */}
      {game.stage === "active" && mission && (
        <div className={styles.missionPanel}>
          {/* ROUND 1: COLOR SNIPER */}
          {mission.kind === "color" && (
            <>
              <div className={styles.missionHeader}>
                <h3>🎨 찾을 색깔: {mission.colorName}</h3>
                <span className={styles.kindBadge}>
                  제출 {game.submittedCount} / {game.expectedCount}명
                </span>
              </div>
              <p className={styles.missionHint}>{mission.prompt}</p>

              {!isPlayer ? (
                <p className={styles.missionHint}>
                  진행자 관전 화면이에요. 참가자들이 셔터를 누르고 있어요!
                </p>
              ) : game.mySubmission?.mode === "color" ? (
                <div className={styles.statusBanner} role="status">
                  <CheckCircle2 size={16} />
                  <span
                    className={styles.swatchDot}
                    style={{ background: game.mySubmission.hex, width: 16, height: 16 }}
                  />
                  <span>
                    셔터 완료! 일치도 <strong>{game.mySubmission.accuracy}%</strong> · 다른 참가자를
                    기다려요
                  </span>
                </div>
              ) : !fallbackMode ? null : (
                <div className={styles.fallbackBox}>
                  <p className={styles.fallbackNotice}>
                    <strong>대체 모드 (색깔 룰렛)</strong> · 움직이는 커서가 찾을 색깔(
                    {mission.colorName})에 왔을 때 스톱 버튼을 눌러요!
                  </p>
                  <div className={styles.rouletteBar}>
                    {rouletteColors.map((hex, idx) => (
                      <span
                        key={`${hex}-${idx}`}
                        className={styles.rouletteCell}
                        data-cursor={idx === rouletteIndex}
                        style={{ background: hex }}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className={styles.shutterBtn}
                    disabled={submitting || busy}
                    onClick={() =>
                      void submitColorShot(rouletteColors[rouletteIndex] ?? "#0A84FE", true)
                    }
                  >
                    <Camera size={18} /> 지금 스톱! 3D 구슬 발사
                  </button>
                </div>
              )}
            </>
          )}

          {/* ROUND 2: TABLE HUNTER */}
          {mission.kind === "object" && (
            <>
              <div className={styles.missionHeader}>
                <h3>📦 찾을 물건: {mission.label}</h3>
                <span className={styles.kindBadge}>
                  포착 {game.submittedCount} / {game.expectedCount}명
                </span>
              </div>
              <p className={styles.missionHint}>{mission.hint}</p>

              {!isPlayer ? (
                <p className={styles.missionHint}>참가자들이 테이블 주변 사물을 스캔하고 있어요!</p>
              ) : game.mySubmission?.mode === "object" ? (
                <div className={styles.statusBanner} role="status">
                  <CheckCircle2 size={16} />
                  <span>
                    3D 캡처 성공! ({(game.mySubmission.elapsedMs / 1000).toFixed(1)}초) · 다른
                    참가자를 기다려요
                  </span>
                </div>
              ) : !fallbackMode ? null : (
                <div className={styles.fallbackBox}>
                  <p className={styles.fallbackNotice}>
                    <strong>대체 모드 (물건 버튼)</strong> · 찾을 물건(
                    <strong>{mission.label}</strong>)에 해당하는 아이콘을 {mission.targetCount + 1}
                    번 연속 탭해 락온하세요!
                  </p>
                  <div className={styles.controlsRow}>
                    {FALLBACK_OBJECT_CHOICES.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={styles.secondaryBtn}
                        disabled={submitting || busy}
                        onClick={() => void handleFallbackObjectTap(item.id)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <div className={styles.meterTrack}>
                    <div
                      className={styles.meterFill}
                      data-success={lockProgress >= 0.7}
                      style={{ width: `${Math.round(lockProgress * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {/* ROUND 3A: 3D SMILE BOMB */}
          {isSmileBomb && (
            <>
              <div className={styles.missionHeader}>
                <h3>💣 웃음 참기</h3>
                <span className={styles.kindBadge}>공격자: {attackerName}</span>
              </div>

              {mission.attackCard && (
                <div className={styles.attackCard}>
                  <small>
                    {isAttacker ? "🎤 내 오프라인 공격 카드!" : `🎤 ${attackerName}님의 도발 미션`}
                  </small>
                  <strong>{mission.attackCard}</strong>
                </div>
              )}

              {isAttacker ? (
                <p className={styles.missionHint}>
                  지금 바로 테이블 사람들을 웃겨보세요! 아래에서 폭탄이 빨갛게 부푼 사람을 집중
                  공격하면 보너스 점수!
                </p>
              ) : !isPlayer ? (
                <p className={styles.missionHint}>
                  수비수들의 3D 폭탄 긴장도를 실시간으로 지켜보세요!
                </p>
              ) : myPopped ? (
                <div className={styles.popBanner} role="status">
                  <Flame size={16} />
                  <span>
                    웃음 폭발! 내 3D 풍선 폭탄이 터졌어요! 이제 같이 다른 사람을 웃겨보세요!
                  </span>
                </div>
              ) : !fallbackMode ? null : (
                <div className={styles.fallbackBox}>
                  <p className={styles.fallbackNotice}>
                    <strong>대체 모드 (정직한 웃참)</strong> · 웃음을 참아보세요! 만약 웃음이
                    터졌다면 솔직하게 아래 폭탄 버튼을 눌러요.
                  </p>
                  <button
                    type="button"
                    className={styles.shutterBtn}
                    style={{ background: "#ef4444" }}
                    onClick={() => void handleFallbackSmilePop()}
                  >
                    <Flame size={18} /> 앗, 웃어버렸다! (내 3D 폭탄 터뜨리기)
                  </button>
                </div>
              )}

              {/* Live All-Defenders Mini Bomb Grid */}
              <div className={styles.bombGrid}>
                {game.roster
                  .filter((p) => p.id !== mission.attackerId)
                  .map((p) => {
                    const live = game.tensions[p.id];
                    const t =
                      p.id === viewerId
                        ? Math.max(myTension, live?.tension ?? 0)
                        : (live?.tension ?? 0);
                    const popped = (p.id === viewerId && myPopped) || !!live?.popped;
                    return (
                      <div key={p.id} className={styles.bombCard} data-popped={popped}>
                        <div className={styles.bombCardHeader}>
                          <span>{p.nickname}</span>
                          <span>{popped ? "💥 팡!" : `${t}%`}</span>
                        </div>
                        <div className={styles.meterTrack} style={{ height: 7 }}>
                          <div
                            className={styles.meterFill}
                            data-danger={t >= 50 || popped}
                            style={{ width: `${popped ? 100 : t}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </>
          )}

          {/* ROUND 3B: 3D AVATAR FACE COPY */}
          {isFaceCopy && (
            <>
              <div className={styles.missionHeader}>
                <h3>🎭 표정 릴레이</h3>
                <span className={styles.kindBadge}>
                  완료 {game.submittedCount} / {game.expectedCount}명
                </span>
              </div>
              <p className={styles.missionHint}>{mission.prompt}</p>

              <div className={styles.comboSteps}>
                {mission.expressions.map((expr, idx) => {
                  const info = SNAP_EXPRESSION_LABELS[expr];
                  const done = !!game.mySubmission || idx < faceStepIndex;
                  const active = !game.mySubmission && idx === faceStepIndex;
                  return (
                    <span
                      key={`${expr}-${idx}`}
                      className={styles.comboPill}
                      data-done={done}
                      data-active={active}
                    >
                      <span>{info.emoji}</span>
                      <span>
                        {idx + 1}. {info.label}
                      </span>
                    </span>
                  );
                })}
              </div>

              {!isPlayer ? (
                <p className={styles.missionHint}>참가자들이 표정 릴레이를 하고 있어요!</p>
              ) : game.mySubmission?.mode === "face-copy" ? (
                <div className={styles.statusBanner} role="status">
                  <CheckCircle2 size={16} />
                  <span>
                    표정 릴레이 성공! ({(game.mySubmission.elapsedMs / 1000).toFixed(1)}초)
                  </span>
                </div>
              ) : !fallbackMode ? null : (
                <div className={styles.fallbackBox}>
                  <p className={styles.fallbackNotice}>
                    <strong>대체 모드 (표정 버튼)</strong> · 위 순서대로 표정 버튼을 눌러요!
                  </p>
                  <div className={styles.controlsRow}>
                    {(Object.keys(SNAP_EXPRESSION_LABELS) as SnapExpressionId[]).map((expr) => (
                      <button
                        key={expr}
                        type="button"
                        className={styles.secondaryBtn}
                        disabled={submitting || busy}
                        onClick={() => void handleFallbackFaceTap(expr)}
                      >
                        {SNAP_EXPRESSION_LABELS[expr].emoji} {SNAP_EXPRESSION_LABELS[expr].label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* REVEAL PANEL */}
      {game.stage === "reveal" && game.lastResult && (
        <div className={styles.missionPanel}>
          <div className={styles.missionHeader}>
            <h3>✨ ROUND {game.lastResult.round} 결과 발표</h3>
            {game.lastResult.mission.kind === "color" && (
              <span className={styles.kindBadge}>
                <span
                  className={styles.swatchDot}
                  style={{
                    background: game.lastResult.mission.targetHex,
                    width: 14,
                    height: 14,
                  }}
                />
                목표: {game.lastResult.mission.colorName}
              </span>
            )}
          </div>
          <ul className={styles.resultList}>
            {game.lastResult.entries.map((entry) => (
              <li key={entry.playerId} className={styles.resultRow}>
                <div className={styles.resultLeft}>
                  <span className={styles.rankTag} data-rank={entry.rank ?? undefined}>
                    {entry.rank ? `${entry.rank}` : "·"}
                  </span>
                  {entry.hex && (
                    <span className={styles.swatchDot} style={{ background: entry.hex }} />
                  )}
                  <div className={styles.resultMeta}>
                    <strong>{entry.nickname}</strong>
                    <small>{entry.detail}</small>
                  </div>
                </div>
                <span className={styles.pointsBadge}>+{entry.points}점</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* FINAL RESULT LEADERBOARD */}
      {(game.stage === "result" || game.stage === "aborted") && (
        <div className={styles.missionPanel}>
          <div className={styles.missionHeader}>
            <h3>
              <Trophy size={16} style={{ display: "inline", marginRight: 6, color: "#f59e0b" }} />
              {game.stage === "aborted" ? "게임이 중단됐어요" : "스냅 팡 3D 최종 순위"}
            </h3>
            <span className={styles.kindBadge}>총 {game.history.length}라운드 완료</span>
          </div>
          <ul className={styles.resultList}>
            {game.roster.map((player, index) => (
              <li key={player.id} className={styles.resultRow}>
                <div className={styles.resultLeft}>
                  <span className={styles.rankTag} data-rank={index + 1}>
                    {index + 1}
                  </span>
                  <span className={styles.swatchDot} style={{ background: player.color }} />
                  <div className={styles.resultMeta}>
                    <strong>
                      {player.nickname}
                      {player.id === viewerId ? " (나)" : ""}
                    </strong>
                    <small>{index === 0 ? "🏆 스냅 팡 챔피언!" : "함께 즐긴 플레이어"}</small>
                  </div>
                </div>
                <span className={styles.pointsBadge}>{player.score}점</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* HOST CONTROLS BAR */}
      {room.isHost && ["briefing", "active", "reveal"].includes(game.stage) && (
        <div className={styles.hostBar}>
          <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>진행자 제어</span>
          <div className={styles.hostActions}>
            <button
              type="button"
              className={styles.secondaryBtn}
              disabled={busy}
              onClick={() => hostControl(game.paused ? "resume" : "pause")}
            >
              {game.paused ? <Play size={14} /> : <Pause size={14} />}
              {game.paused ? "재개" : "일시정지"}
            </button>
            <button
              type="button"
              className={styles.secondaryBtn}
              disabled={busy}
              onClick={() => hostControl("next")}
            >
              <SkipForward size={14} /> 다음 단계로
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
