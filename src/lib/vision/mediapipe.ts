"use client";

import type { FaceLandmarker, ObjectDetector } from "@mediapipe/tasks-vision";
import type { SnapExpressionId } from "@/domain/snap-pang";

const VISION_WASM_BASE = "/models/vision/wasm";
const OBJECT_MODEL_PATH = "/models/vision/efficientdet_lite0.tflite";
const FACE_MODEL_PATH = "/models/vision/face_landmarker.task";

export type FaceTelemetry = {
  faceDetected: boolean;
  smile: number; // 0..1
  jawOpen: number; // 0..1
  winkLeft: number; // 0..1
  winkRight: number; // 0..1
  browDown: number; // 0..1
  pucker: number; // 0..1
  headYaw: number; // -1..1
  headPitch: number; // -1..1
  headRoll: number; // -1..1
};

export const NEUTRAL_FACE_TELEMETRY: FaceTelemetry = {
  faceDetected: false,
  smile: 0,
  jawOpen: 0,
  winkLeft: 0,
  winkRight: 0,
  browDown: 0,
  pucker: 0,
  headYaw: 0,
  headPitch: 0,
  headRoll: 0,
};

export type DetectedObjectBox = {
  label: string;
  score: number;
  x: number; // normalized 0..1
  y: number;
  width: number;
  height: number;
};

/** Lowest detector score kept; callers decide per mission what counts as a real sighting. */
export const OBJECT_SCORE_FLOOR = 0.2;

let filesetPromise: Promise<
  Awaited<ReturnType<typeof import("@mediapipe/tasks-vision").FilesetResolver.forVisionTasks>>
> | null = null;
let objectDetectorPromise: Promise<ObjectDetector> | null = null;
let faceLandmarkerPromise: Promise<FaceLandmarker> | null = null;

async function getFileset() {
  if (!filesetPromise) {
    filesetPromise = import("@mediapipe/tasks-vision").then(({ FilesetResolver }) =>
      FilesetResolver.forVisionTasks(VISION_WASM_BASE),
    );
  }
  return filesetPromise;
}

export async function getObjectDetector(): Promise<ObjectDetector> {
  if (!objectDetectorPromise) {
    objectDetectorPromise = (async () => {
      const [{ ObjectDetector: Detector }, fileset] = await Promise.all([
        import("@mediapipe/tasks-vision"),
        getFileset(),
      ]);
      // CPU (XNNPACK) only. With the GPU delegate this EfficientDet model loads without error but
      // returns zero detections for frames the CPU path labels correctly (a mug at 0.55, a chair at
      // 0.59), so the old "GPU first" choice silently broke 물건 찾기.
      return await Detector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: OBJECT_MODEL_PATH, delegate: "CPU" },
        runningMode: "VIDEO",
        scoreThreshold: OBJECT_SCORE_FLOOR,
        maxResults: 12,
      });
    })().catch((err) => {
      objectDetectorPromise = null;
      throw err;
    });
  }
  return objectDetectorPromise;
}

export async function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = (async () => {
      const [{ FaceLandmarker: Landmarker }, fileset] = await Promise.all([
        import("@mediapipe/tasks-vision"),
        getFileset(),
      ]);
      try {
        return await Landmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: FACE_MODEL_PATH, delegate: "GPU" },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
          minFaceDetectionConfidence: 0.45,
          minTrackingConfidence: 0.45,
        });
      } catch {
        return await Landmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: FACE_MODEL_PATH, delegate: "CPU" },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
          minFaceDetectionConfidence: 0.45,
          minTrackingConfidence: 0.45,
        });
      }
    })().catch((err) => {
      faceLandmarkerPromise = null;
      throw err;
    });
  }
  return faceLandmarkerPromise;
}

/** Warms up only the models a mode will use, so its first camera round starts quickly. */
export function preloadSnapVision(models: { object: boolean; face: boolean }) {
  if (typeof window === "undefined") return;
  if (models.object) void getObjectDetector().catch(() => {});
  if (models.face) void getFaceLandmarker().catch(() => {});
}

let cropCanvas: HTMLCanvasElement | null = null;

/**
 * Detects objects in the current video frame. With `crop` < 1 it looks at the centered part of
 * the frame only, so objects held farther away fill more of the model's small input; boxes are
 * always returned in whole-frame coordinates (0..1).
 */
export function runObjectDetection(
  detector: ObjectDetector,
  video: HTMLVideoElement,
  timestampMs: number,
  crop = 1,
): DetectedObjectBox[] {
  if (video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) return [];
  const w = video.videoWidth;
  const h = video.videoHeight;
  let source: HTMLVideoElement | HTMLCanvasElement = video;
  let sx = 0,
    sy = 0;
  if (crop < 1) {
    const sw = Math.round(w * crop),
      sh = Math.round(h * crop);
    sx = Math.round((w - sw) / 2);
    sy = Math.round((h - sh) / 2);
    cropCanvas ??= document.createElement("canvas");
    if (cropCanvas.width !== sw || cropCanvas.height !== sh) {
      cropCanvas.width = sw;
      cropCanvas.height = sh;
    }
    cropCanvas.getContext("2d")?.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
    source = cropCanvas;
  }
  const result = detector.detectForVideo(source, timestampMs);
  const out: DetectedObjectBox[] = [];
  for (const det of result.detections) {
    const top = det.categories[0];
    const box = det.boundingBox;
    if (!top || !box) continue;
    out.push({
      label: top.categoryName.toLowerCase(),
      score: top.score,
      x: Math.max(0, Math.min(1, (sx + box.originX) / w)),
      y: Math.max(0, Math.min(1, (sy + box.originY) / h)),
      width: Math.max(0, Math.min(1, box.width / w)),
      height: Math.max(0, Math.min(1, box.height / h)),
    });
  }
  return out;
}

/** Counts distinct objects: overlapping boxes (one mug seen as "cup" and "bowl") count once. */
export function countDistinctBoxes(boxes: DetectedObjectBox[]): number {
  const kept: DetectedObjectBox[] = [];
  for (const box of [...boxes].sort((a, b) => b.score - a.score)) {
    const overlaps = kept.some((k) => {
      const ix = Math.max(0, Math.min(k.x + k.width, box.x + box.width) - Math.max(k.x, box.x));
      const iy = Math.max(0, Math.min(k.y + k.height, box.y + box.height) - Math.max(k.y, box.y));
      const inter = ix * iy;
      const union = k.width * k.height + box.width * box.height - inter;
      return union > 0 && inter / union > 0.45;
    });
    if (!overlaps) kept.push(box);
  }
  return kept.length;
}

export function runFaceTelemetry(
  landmarker: FaceLandmarker,
  video: HTMLVideoElement,
  timestampMs: number,
): FaceTelemetry {
  if (video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) {
    return NEUTRAL_FACE_TELEMETRY;
  }
  const result = landmarker.detectForVideo(video, timestampMs);
  const blend = result.faceBlendshapes?.[0]?.categories;
  if (!blend || blend.length === 0) return NEUTRAL_FACE_TELEMETRY;

  const map = new Map<string, number>();
  for (const entry of blend) map.set(entry.categoryName, entry.score);
  const get = (name: string) => map.get(name) ?? 0;

  const smile = Math.max(
    (get("mouthSmileLeft") + get("mouthSmileRight")) / 2,
    Math.max(get("mouthSmileLeft"), get("mouthSmileRight")) * 0.85,
  );
  const jawOpen = get("jawOpen");
  const winkLeft = get("eyeBlinkLeft");
  const winkRight = get("eyeBlinkRight");
  // Frowns are often lopsided, so a strong brow on either side counts.
  const browDown = Math.max(
    (get("browDownLeft") + get("browDownRight")) / 2,
    Math.max(get("browDownLeft"), get("browDownRight")) * 0.85,
  );
  const pucker = Math.max(get("mouthPucker"), get("mouthFunnel") * 0.8);

  // Extract rough head orientation from 4x4 transformation matrix if available
  let headYaw = 0;
  let headPitch = 0;
  let headRoll = 0;
  const m = result.facialTransformationMatrixes?.[0]?.data;
  if (m && m.length >= 16) {
    // Column-major 4x4 rotation elements
    headYaw = Math.max(-1, Math.min(1, (m[8] ?? 0) * 1.4));
    headPitch = Math.max(-1, Math.min(1, -(m[9] ?? 0) * 1.4));
    headRoll = Math.max(-1, Math.min(1, (m[1] ?? 0) * 1.2));
  }

  return {
    faceDetected: true,
    smile: Math.min(1, smile),
    jawOpen: Math.min(1, jawOpen),
    winkLeft: Math.min(1, winkLeft),
    winkRight: Math.min(1, winkRight),
    browDown: Math.min(1, browDown),
    pucker: Math.min(1, pucker),
    headYaw,
    headPitch,
    headRoll,
  };
}

/** Pure expression matcher (0..1 confidence) for 3D Avatar Face Copy rounds. */
export function scoreExpressionMatch(telemetry: FaceTelemetry, target: SnapExpressionId): number {
  if (!telemetry.faceDetected) return 0;
  if (target === "surprise") {
    return Math.min(1, telemetry.jawOpen * 1.45);
  }
  if (target === "happy") {
    return Math.min(1, telemetry.smile * 1.45);
  }
  if (target === "wink") {
    const diff = Math.abs(telemetry.winkLeft - telemetry.winkRight);
    const closed = Math.max(telemetry.winkLeft, telemetry.winkRight);
    return Math.min(1, Math.min(diff * 1.8, closed * 1.35));
  }
  if (target === "angry") {
    return Math.min(1, telemetry.browDown * 1.75);
  }
  // pucker
  return Math.min(1, telemetry.pucker * 1.45);
}

/**
 * Computes instantaneous smile-bomb laugh intensity (0..1) from live face telemetry.
 * Above ~0.32 counts as cracking a smile; bursts smoothly when laughing.
 */
export function smileBurstIntensity(telemetry: FaceTelemetry): number {
  if (!telemetry.faceDetected) return 0;
  return Math.min(1, telemetry.smile * 0.85 + telemetry.jawOpen * 0.35);
}
