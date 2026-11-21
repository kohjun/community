"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
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
  SNAP_EXPRESSION_LABELS,
  SNAP_PANG_PRESET_META,
  type SnapExpressionId,
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

const KIND_LABELS = {
  color: "🎨 컬러 스나이퍼",
  object: "📦 테이블 헌터",
  face: "😶 3D 포커페이스",
} as const;

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
  const missionKind = mission?.kind;
  const hasSubmission = Boolean(game.mySubmission);
  const isSmileBomb = mission?.kind === "face" && mission.subMode === "smile-bomb";
  const isFaceCopy = mission?.kind === "face" && mission.subMode === "face-copy";
  const isAttacker = isSmileBomb && mission?.attackerId === viewerId;

  const [muted, setMuted] = useState(false);
  const [fallbackMode, setFallbackMode] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [facingOverride, setFacingOverride] = useState<CameraFacing | null>(null);
  const [showRawFace, setShowRawFace] = useState(false);
  const [modelStatus, setModelStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [lowLight, setLowLight] = useState(false);

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
  const submittedRoundRef = useRef<string>("");
  const lastPulseSentRef = useRef<{ at: number; tension: number; popped: boolean }>({
    at: 0,
    tension: 0,
    popped: false,
  });
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

  const roundKey = `${game.runId ?? "none"}:${game.round}:${game.stage}`;
  // The mission is fixed for a round. Fresh room snapshots must not restart tracking timers.
  const getRoundMission = useEffectEvent(() => game.mission);
  const sendDetection = useEffectEvent((action: Record<string, unknown>) => onAction(action));
  const canAnalyze = useEffectEvent(() => !game.paused && !document.hidden);
  const desiredFacing: CameraFacing =
    facingOverride ?? (mission?.kind === "face" ? "user" : "environment");
  const needsCamera =
    isPlayer &&
    !fallbackMode &&
    !isAttacker &&
    (game.stage === "briefing" || game.stage === "active") &&
    !game.mySubmission;

  // Gently preload MediaPipe WASM & models in background when game enters play
  useEffect(() => {
    preloadSnapVision(game.settings.preset !== "light");
  }, [game.settings.preset]);

  // Reset per-round local state
  useEffect(() => {
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
    submittedRoundRef.current = "";
    lastPulseSentRef.current = { at: 0, tension: 0, popped: false };
    liveRef.current.lockProgress = 0;
    liveRef.current.tension = 0;
    liveRef.current.popped = false;
    liveRef.current.face = NEUTRAL_FACE_TELEMETRY;
  }, [game.runId, game.round]);

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

  // Round 1: Color Sniper live center sampler (0MB pure Canvas + CIE Lab)
  useEffect(() => {
    if (
      game.stage !== "active" ||
      mission?.kind !== "color" ||
      !cameraReady ||
      fallbackMode ||
      !!game.mySubmission
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
      if (!canAnalyze()) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth <= 0) return;
      ctx.drawImage(video, 0, 0, 96, 96);
      const pixels = ctx.getImageData(0, 0, 96, 96).data;
      const { rgb, luma } = sampleCenterRgb(pixels, 96, 96, 0.16);
      const hex = rgbToHex(rgb);
      const accuracy = computeColorMatchScore(mission.targetHex, hex);
      setSampleHex(hex);
      setColorAccuracy(accuracy);
      setLowLight(luma < 36);
      liveRef.current.sampleHex = hex;
      liveRef.current.colorAccuracy = accuracy;
    }, 120);
    return () => clearInterval(timer);
  }, [game.stage, mission, cameraReady, fallbackMode, game.mySubmission]);

  // Round 2: Table Hunter MediaPipe ObjectDetector loop (~10fps throttled)
  useEffect(() => {
    if (
      game.stage !== "active" ||
      missionKind !== "object" ||
      !cameraReady ||
      fallbackMode ||
      hasSubmission ||
      !isPlayer
    )
      return;
    const mission = getRoundMission();
    if (mission?.kind !== "object") return;

    let alive = true;
    let lockMs = 0;
    let lastTick = performance.now();
    let tickMilestone = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    setModelStatus("loading");

    void getObjectDetector()
      .then((detector) => {
        if (!alive) return;
        setModelStatus("ready");
        timer = setInterval(() => {
          const video = videoRef.current;
          if (!video || video.readyState < 2 || submittedRoundRef.current === roundKey) return;
          const now = performance.now();
          const dt = Math.min(250, now - lastTick);
          lastTick = now;
          if (!canAnalyze()) return;
          const boxes = runObjectDetection(detector, video, now);
          const matching = boxes.filter(
            (b) => mission.cocoLabels.includes(b.label) && b.score >= 0.36,
          );
          setDetectedBoxes(matching.length > 0 ? matching : boxes.slice(0, 2));

          if (matching.length >= mission.targetCount) {
            lockMs = Math.min(600, lockMs + dt);
          } else {
            lockMs = Math.max(0, lockMs - dt * 0.7);
          }
          const progress = Math.min(1, lockMs / 600);
          setLockProgress(progress);
          liveRef.current.lockProgress = progress;

          if (progress >= 0.35 && tickMilestone < 1) {
            tickMilestone = 1;
            snapSfx.play("lockTick");
          } else if (progress >= 0.7 && tickMilestone < 2) {
            tickMilestone = 2;
            snapSfx.play("lockTick");
          }

          if (progress >= 1 && game.runId) {
            submittedRoundRef.current = roundKey;
            const bestConf = Math.max(...matching.map((m) => m.score), 0.5);
            snapSfx.play("capture");
            trigger3dBurst("capture", me?.color ?? "#0A84FE");
            setSubmitting(true);
            void sendDetection({
              action: "snap-object",
              runId: game.runId,
              round: game.round,
              confidence: Number(bestConf.toFixed(2)),
              fallback: false,
            })?.then((ok) => {
              if (ok || !alive) return;
              submittedRoundRef.current = "";
              setSubmitting(false);
            });
          }
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
    game.runId,
    game.round,
    hasSubmission,
    missionKind,
    cameraReady,
    fallbackMode,
    isPlayer,
    roundKey,
    me?.color,
    trigger3dBurst,
  ]);

  // Round 3: 3D Pokerface & Smile Bomb MediaPipe FaceLandmarker loop (~11fps throttled)
  useEffect(() => {
    if (
      game.stage !== "active" ||
      missionKind !== "face" ||
      isAttacker ||
      !cameraReady ||
      fallbackMode ||
      hasSubmission ||
      !isPlayer
    )
      return;
    const mission = getRoundMission();
    if (mission?.kind !== "face") return;

    let alive = true;
    let tensionVal = 0;
    let poppedLocal = false;
    let copyStep = 0;
    let holdMs = 0;
    let lastTick = performance.now();
    let timer: ReturnType<typeof setInterval> | null = null;
    setModelStatus("loading");

    void getFaceLandmarker()
      .then((landmarker) => {
        if (!alive) return;
        setModelStatus("ready");
        timer = setInterval(() => {
          const video = videoRef.current;
          if (!video || video.readyState < 2) return;
          const now = performance.now();
          const dtSec = Math.min(0.25, (now - lastTick) / 1000);
          lastTick = now;
          if (!canAnalyze()) return;

          const telemetry = runFaceTelemetry(landmarker, video, now);
          liveRef.current.face = telemetry;
          setFaceDetected(telemetry.faceDetected);

          if (mission.subMode === "smile-bomb") {
            if (poppedLocal) return;
            const intensity = smileBurstIntensity(telemetry);
            if (intensity > 0.28) {
              tensionVal = Math.min(100, tensionVal + (intensity - 0.23) * 145 * dtSec);
            } else {
              tensionVal = Math.max(0, tensionVal - 8 * dtSec);
            }
            const rounded = Math.round(tensionVal);
            setMyTension(rounded);
            liveRef.current.tension = rounded;

            const shouldPop = rounded >= 100;
            const last = lastPulseSentRef.current;
            const changedEnough = Math.abs(rounded - last.tension) >= 12;
            if (game.runId && (shouldPop || (now - last.at >= 1400 && changedEnough))) {
              lastPulseSentRef.current = { at: now, tension: rounded, popped: shouldPop };
              if (shouldPop) {
                poppedLocal = true;
                setMyPopped(true);
                liveRef.current.popped = true;
                snapSfx.play("pop");
                trigger3dBurst("pop", me?.color ?? "#EF4444");
              }
              void sendDetection({
                action: "snap-tension",
                runId: game.runId,
                round: game.round,
                tension: rounded,
                popped: shouldPop,
                fallback: false,
              });
            }
            return;
          }

          // face-copy sub-mode
          if (submittedRoundRef.current === roundKey) return;
          const targetExpr = mission.expressions[copyStep];
          if (!targetExpr) return;
          const matchScore = scoreExpressionMatch(telemetry, targetExpr);
          if (matchScore >= 0.5) {
            holdMs = Math.min(450, holdMs + dtSec * 1000);
          } else {
            holdMs = Math.max(0, holdMs - dtSec * 650);
          }
          setFaceStepProgress(Math.min(1, holdMs / 450));

          if (holdMs >= 450) {
            holdMs = 0;
            copyStep += 1;
            setFaceStepIndex(copyStep);
            setFaceStepProgress(0);
            if (copyStep < mission.expressions.length) {
              snapSfx.play("lockTick");
            } else if (game.runId) {
              submittedRoundRef.current = roundKey;
              snapSfx.play("capture");
              trigger3dBurst("capture", me?.color ?? "#0A84FE");
              setSubmitting(true);
              void sendDetection({
                action: "snap-face-copy",
                runId: game.runId,
                round: game.round,
                fallback: false,
              })?.then((ok) => {
                if (ok || !alive) return;
                copyStep -= 1;
                setFaceStepIndex(copyStep);
                submittedRoundRef.current = "";
                setSubmitting(false);
              });
            }
          }
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
    game.runId,
    game.round,
    hasSubmission,
    missionKind,
    isAttacker,
    cameraReady,
    fallbackMode,
    isPlayer,
    roundKey,
    me?.color,
    trigger3dBurst,
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
    const ok = await onAction({
      action: "snap-color",
      runId: game.runId,
      round: game.round,
      hex,
      fallback: isFallback,
    });
    if (ok === false) setSubmitting(false);
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
    await onAction({
      action: "snap-tension",
      runId: game.runId,
      round: game.round,
      tension: 100,
      popped: true,
      fallback: true,
    });
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

  const attackerName =
    isSmileBomb && mission.attackerId
      ? (game.roster.find((p) => p.id === mission.attackerId)?.nickname ?? "공격자")
      : null;

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
            <span className={styles.kindBadge}>{KIND_LABELS[mission.kind]}</span>
          )}
          <span className={styles.kindBadge}>
            {SNAP_PANG_PRESET_META[game.settings.preset].badge}
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

      {/* Main 3D Viewport + PIP Camera Viewfinder */}
      <div className={styles.viewport}>
        <SnapPang3dStage
          stage={game.stage}
          mission={mission}
          roster={game.roster}
          lastResult={game.lastResult}
          avatarColor={me?.color ?? "#0A84FE"}
          liveRef={liveRef}
        />

        {/* HUD Top Overlay */}
        {mission && game.stage !== "result" && (
          <div className={styles.hudTop}>
            <div className={styles.missionChip}>
              {mission.kind === "color" && (
                <>
                  <span className={styles.swatchDot} style={{ background: mission.targetHex }} />
                  <span>목표: {mission.colorName}</span>
                </>
              )}
              {mission.kind === "object" && <span>포착: {mission.label}</span>}
              {mission.kind === "face" && (
                <span>
                  {mission.subMode === "smile-bomb"
                    ? "💣 웃음 참기 3D 폭탄"
                    : "🎭 3D 아바타 표정 카피"}
                </span>
              )}
            </div>
            {mission.kind === "face" && !isAttacker && !fallbackMode && (
              <button
                type="button"
                className={styles.privacyChip}
                onClick={() => setShowRawFace((v) => !v)}
              >
                {showRawFace ? <EyeOff size={12} /> : <Eye size={12} />}
                {showRawFace ? "얼굴 숨기기" : "아바타 마스크 ON"}
              </button>
            )}
          </div>
        )}

        {/* PIP Camera Viewfinder (Hidden by default on Face rounds for 100% 3D Avatar Mask!) */}
        {needsCamera && (
          <div
            className={styles.pipWrap}
            data-hidden-face={mission?.kind === "face" && !showRawFace}
          >
            <video
              ref={videoRef}
              className={styles.pipVideo}
              data-mirror={desiredFacing === "user"}
              muted
              playsInline
              autoPlay
            />
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

        {/* Briefing Overlay */}
        {game.stage === "briefing" && mission && (
          <div className={styles.briefOverlay}>
            <div className={styles.briefCard}>
              <span className={styles.roundBadge}>
                ROUND {game.round} · {KIND_LABELS[mission.kind]}
              </span>
              <h3>
                {mission.kind === "color"
                  ? `${mission.colorName} 찾기!`
                  : mission.kind === "object"
                    ? `${mission.label} 포착!`
                    : mission.subMode === "smile-bomb"
                      ? "웃으면 3D 폭탄 팡!"
                      : "3D 아바타 표정 카피!"}
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
              style={{ minHeight: 32, fontSize: 12 }}
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
                <h3>🎨 목표 색: {mission.colorName}</h3>
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
              ) : !fallbackMode ? (
                <>
                  <div className={styles.meterWrap}>
                    <div className={styles.meterLabels}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span
                          className={styles.swatchDot}
                          style={{ background: sampleHex, width: 16, height: 16 }}
                        />
                        현재 조준 색 ({sampleHex})
                      </span>
                      <strong>일치도 {colorAccuracy}%</strong>
                    </div>
                    <div className={styles.meterTrack}>
                      <div
                        className={styles.meterFill}
                        data-success={colorAccuracy >= 75}
                        style={{ width: `${colorAccuracy}%` }}
                      />
                    </div>
                  </div>
                  <div className={styles.controlsRow}>
                    <button
                      type="button"
                      className={styles.shutterBtn}
                      disabled={!cameraReady || submitting || busy}
                      onClick={() => void submitColorShot(sampleHex, false)}
                    >
                      <Camera size={18} />
                      {cameraReady ? "셔터 팡! 이 색으로 확정" : "카메라 준비 중…"}
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={() =>
                        setFacingOverride((f) => (f === "user" ? "environment" : "user"))
                      }
                    >
                      <RefreshCw size={14} /> 카메라 전환
                    </button>
                  </div>
                </>
              ) : (
                <div className={styles.fallbackBox}>
                  <p className={styles.fallbackNotice}>
                    <strong>대체 모드 (컬러 룰렛)</strong> · 움직이는 커서가 목표 색(
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
                <h3>📦 미션 사물: {mission.label}</h3>
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
              ) : !fallbackMode ? (
                <>
                  <div className={styles.meterWrap}>
                    <div className={styles.meterLabels}>
                      <span>
                        {modelStatus === "loading"
                          ? "온디바이스 사물 AI 로딩 중…"
                          : detectedBoxes.length > 0
                            ? `감지 중: ${detectedBoxes
                                .slice(0, 2)
                                .map((b) => OBJECT_LABEL_KO[b.label] ?? b.label)
                                .join(", ")}`
                            : "미션 사물을 카메라에 비춰보세요"}
                      </span>
                      <strong>락온 {Math.round(lockProgress * 100)}%</strong>
                    </div>
                    <div className={styles.meterTrack}>
                      <div
                        className={styles.meterFill}
                        data-success={lockProgress >= 0.7}
                        style={{ width: `${Math.round(lockProgress * 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className={styles.controlsRow}>
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={() =>
                        setFacingOverride((f) => (f === "user" ? "environment" : "user"))
                      }
                    >
                      <RefreshCw size={14} /> 카메라 전환
                    </button>
                  </div>
                </>
              ) : (
                <div className={styles.fallbackBox}>
                  <p className={styles.fallbackNotice}>
                    <strong>대체 모드 (테이블 빠른 포착)</strong> · 미션 사물(
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
                <h3>💣 웃음 참기 3D 폭탄</h3>
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
              ) : !fallbackMode ? (
                <div className={styles.meterWrap}>
                  <div className={styles.meterLabels}>
                    <span>
                      {modelStatus === "loading"
                        ? "3D 아바타 표정 엔진 로딩 중…"
                        : faceDetected
                          ? "3D 아바타가 내 표정을 읽고 있어요 — 웃지 마세요!"
                          : "얼굴이 프레임 안에 들어오게 폰을 살짝 들어주세요"}
                    </span>
                    <strong>폭탄 팽창 {myTension}%</strong>
                  </div>
                  <div className={styles.meterTrack}>
                    <div
                      className={styles.meterFill}
                      data-danger={myTension >= 50}
                      style={{ width: `${myTension}%` }}
                    />
                  </div>
                </div>
              ) : (
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
                <h3>🎭 3D 아바타 표정 카피</h3>
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
                <p className={styles.missionHint}>
                  참가자들이 3D 아바타로 표정을 따라 하고 있어요!
                </p>
              ) : game.mySubmission?.mode === "face-copy" ? (
                <div className={styles.statusBanner} role="status">
                  <CheckCircle2 size={16} />
                  <span>표정 콤보 완료! ({(game.mySubmission.elapsedMs / 1000).toFixed(1)}초)</span>
                </div>
              ) : !fallbackMode ? (
                <div className={styles.meterWrap}>
                  <div className={styles.meterLabels}>
                    <span>
                      {modelStatus === "loading"
                        ? "표정 AI 로딩 중…"
                        : mission.expressions[faceStepIndex]
                          ? SNAP_EXPRESSION_LABELS[mission.expressions[faceStepIndex]!].cue
                          : "완료!"}
                    </span>
                    <strong>{Math.round(faceStepProgress * 100)}%</strong>
                  </div>
                  <div className={styles.meterTrack}>
                    <div
                      className={styles.meterFill}
                      data-success={faceStepProgress >= 0.65}
                      style={{ width: `${Math.round(faceStepProgress * 100)}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div className={styles.fallbackBox}>
                  <p className={styles.fallbackNotice}>
                    <strong>대체 모드 (표정 콤보 터치)</strong> · 위 순서대로 표정 버튼을 눌러 3D
                    아바타를 연기시키세요!
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
