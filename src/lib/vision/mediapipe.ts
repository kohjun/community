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
      try {
        return await Detector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: OBJECT_MODEL_PATH, delegate: "GPU" },
          runningMode: "VIDEO",
          scoreThreshold: 0.34,
          maxResults: 6,
        });
      } catch {
        return await Detector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: OBJECT_MODEL_PATH, delegate: "CPU" },
          runningMode: "VIDEO",
          scoreThreshold: 0.34,
          maxResults: 6,
        });
      }
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

/** Gently warms up MediaPipe WASM/models in the background so Round 2/3 start instantly. */
export function preloadSnapVision(usesFace: boolean) {
  if (typeof window === "undefined") return;
  void getObjectDetector().catch(() => {});
  if (usesFace) void getFaceLandmarker().catch(() => {});
}

export function runObjectDetection(
  detector: ObjectDetector,
  video: HTMLVideoElement,
  timestampMs: number,
): DetectedObjectBox[] {
  if (video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) return [];
  const result = detector.detectForVideo(video, timestampMs);
  const w = video.videoWidth;
  const h = video.videoHeight;
  const out: DetectedObjectBox[] = [];
  for (const det of result.detections) {
    const top = det.categories[0];
    const box = det.boundingBox;
    if (!top || !box) continue;
    out.push({
      label: top.categoryName.toLowerCase(),
      score: top.score,
      x: Math.max(0, Math.min(1, box.originX / w)),
      y: Math.max(0, Math.min(1, box.originY / h)),
      width: Math.max(0, Math.min(1, box.width / w)),
      height: Math.max(0, Math.min(1, box.height / h)),
    });
  }
  return out;
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
  const browDown = (get("browDownLeft") + get("browDownRight")) / 2;
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
