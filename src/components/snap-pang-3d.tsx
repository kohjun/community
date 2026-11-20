"use client";

import { Component, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type {
  SnapMission,
  SnapPangPlayer,
  SnapPangStage,
  SnapRoundResult,
} from "@/domain/snap-pang";
import { NEUTRAL_FACE_TELEMETRY, type FaceTelemetry } from "@/lib/vision/mediapipe";

export type Snap3dLiveState = {
  sampleHex: string;
  colorAccuracy: number;
  lockProgress: number; // 0..1
  tension: number; // 0..100
  popped: boolean;
  face: FaceTelemetry;
  burstCounter: number;
  burstKind: "paint" | "capture" | "pop" | "confetti";
  burstColor: string;
};

type Props = {
  stage: SnapPangStage;
  mission: SnapMission | null;
  roster: SnapPangPlayer[];
  lastResult: SnapRoundResult | null;
  avatarColor: string;
  liveRef: RefObject<Snap3dLiveState>;
  onFallback?: () => void;
};

class SceneBoundary extends Component<
  { children: ReactNode; onFail: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

type RapierMod = typeof import("@dimforge/rapier3d-compat");
type RapierWorld = InstanceType<RapierMod["World"]>;
type RapierBody = ReturnType<RapierWorld["createRigidBody"]>;

type DynamicPiece = {
  mesh: THREE.Mesh;
  body: RapierBody | null;
  // Kinematic fallback when Rapier WASM is still warming up
  vel: THREE.Vector3;
  rotVel: THREE.Vector3;
  bornAt: number;
  ttlMs: number;
};

type AvatarRig = {
  root: THREE.Group;
  head: THREE.Mesh;
  headMat: THREE.MeshStandardMaterial;
  leftEye: THREE.Mesh;
  rightEye: THREE.Mesh;
  leftBrow: THREE.Mesh;
  rightBrow: THREE.Mesh;
  mouth: THREE.Mesh;
  leftCheek: THREE.Mesh;
  rightCheek: THREE.Mesh;
  fuseGroup: THREE.Group;
  spark: THREE.Mesh;
};

function createAvatarRig(baseColor: string): AvatarRig {
  const root = new THREE.Group();
  const headGeo = new THREE.SphereGeometry(0.95, 28, 24);
  const headMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(baseColor),
    roughness: 0.24,
    metalness: 0.08,
  });
  const head = new THREE.Mesh(headGeo, headMat);
  head.castShadow = true;
  head.receiveShadow = true;
  root.add(head);

  // Cute glossy ears
  const earGeo = new THREE.SphereGeometry(0.26, 16, 14);
  const leftEar = new THREE.Mesh(earGeo, headMat);
  leftEar.position.set(-0.78, 0.65, -0.05);
  const rightEar = new THREE.Mesh(earGeo, headMat);
  rightEar.position.set(0.78, 0.65, -0.05);
  head.add(leftEar, rightEar);

  // Eyes with specular highlight dot
  const eyeGeo = new THREE.SphereGeometry(0.145, 16, 14);
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0x172033,
    roughness: 0.12,
    metalness: 0.2,
  });
  const shineGeo = new THREE.SphereGeometry(0.045, 10, 10);
  const shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.33, 0.14, 0.84);
  const leftShine = new THREE.Mesh(shineGeo, shineMat);
  leftShine.position.set(0.05, 0.05, 0.11);
  leftEye.add(leftShine);

  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  rightEye.position.set(0.33, 0.14, 0.84);
  const rightShine = new THREE.Mesh(shineGeo, shineMat);
  rightShine.position.set(0.05, 0.05, 0.11);
  rightEye.add(rightShine);
  head.add(leftEye, rightEye);

  // Eyebrows
  const browGeo = new THREE.BoxGeometry(0.3, 0.07, 0.08);
  const browMat = new THREE.MeshStandardMaterial({ color: 0x172033, roughness: 0.35 });
  const leftBrow = new THREE.Mesh(browGeo, browMat);
  leftBrow.position.set(-0.33, 0.39, 0.84);
  const rightBrow = new THREE.Mesh(browGeo, browMat);
  rightBrow.position.set(0.33, 0.39, 0.84);
  head.add(leftBrow, rightBrow);

  // Cheeks
  const cheekGeo = new THREE.SphereGeometry(0.14, 14, 12);
  const cheekMat = new THREE.MeshStandardMaterial({
    color: 0xff8fab,
    roughness: 0.5,
    transparent: true,
    opacity: 0.65,
  });
  const leftCheek = new THREE.Mesh(cheekGeo, cheekMat);
  leftCheek.scale.set(1.2, 0.68, 0.45);
  leftCheek.position.set(-0.54, -0.08, 0.78);
  const rightCheek = new THREE.Mesh(cheekGeo, cheekMat);
  rightCheek.scale.set(1.2, 0.68, 0.45);
  rightCheek.position.set(0.54, -0.08, 0.78);
  head.add(leftCheek, rightCheek);

  // Mouth
  const mouthGeo = new THREE.CapsuleGeometry(0.09, 0.22, 8, 14);
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0x2a1829, roughness: 0.3 });
  const mouth = new THREE.Mesh(mouthGeo, mouthMat);
  mouth.rotation.z = Math.PI / 2;
  mouth.position.set(0, -0.26, 0.86);
  head.add(mouth);

  // Bomb fuse & glowing spark (shown in smile-bomb mode)
  const fuseGroup = new THREE.Group();
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.28, 0.22, 16),
    new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.35, metalness: 0.5 }),
  );
  cap.position.set(0, 1.0, 0);
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 0.42, 10),
    new THREE.MeshStandardMaterial({ color: 0xd6b588, roughness: 0.8 }),
  );
  stem.position.set(0.05, 1.24, 0);
  stem.rotation.z = -0.25;
  const spark = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.16, 0),
    new THREE.MeshStandardMaterial({
      color: 0xffd166,
      emissive: 0xff5a1f,
      emissiveIntensity: 1.6,
      roughness: 0.2,
    }),
  );
  spark.position.set(0.12, 1.48, 0);
  fuseGroup.add(cap, stem, spark);
  head.add(fuseGroup);

  return {
    root,
    head,
    headMat,
    leftEye,
    rightEye,
    leftBrow,
    rightBrow,
    mouth,
    leftCheek,
    rightCheek,
    fuseGroup,
    spark,
  };
}

function ArenaWorld(props: Props) {
  const { gl, scene } = useThree();
  const latest = useRef(props);
  latest.current = props;

  const arenaRef = useRef<THREE.Group>(null);
  const dynamicGroupRef = useRef<THREE.Group>(null);
  const piecesRef = useRef<DynamicPiece[]>([]);
  const rapierRef = useRef<{ R: RapierMod; world: RapierWorld } | null>(null);
  const lastBurstRef = useRef(0);
  const lastRevealKeyRef = useRef("");
  const lastPodiumSpawnRef = useRef(0);

  // Reusable hero object refs
  const colorGroupRef = useRef<THREE.Group>(null);
  const targetCrystalRef = useRef<THREE.Mesh>(null);
  const targetRingRef = useRef<THREE.Mesh>(null);
  const sampleOrbRef = useRef<THREE.Mesh>(null);

  const objectGroupRef = useRef<THREE.Group>(null);
  const crateRef = useRef<THREE.Mesh>(null);
  const beamRef = useRef<THREE.Mesh>(null);
  const radarRingRef = useRef<THREE.Mesh>(null);

  const faceHolderRef = useRef<THREE.Group>(null);
  const avatarRigRef = useRef<AvatarRig | null>(null);

  const podiumGroupRef = useRef<THREE.Group>(null);
  const podiumAvatarsRef = useRef<THREE.Group[]>([]);
  const crownRef = useRef<THREE.Mesh>(null);

  // Smoothly interpolated telemetry values
  const smooth = useRef({
    smile: 0,
    jawOpen: 0,
    winkLeft: 0,
    winkRight: 0,
    browDown: 0,
    pucker: 0,
    headYaw: 0,
    headPitch: 0,
    headRoll: 0,
    tension: 0,
    lock: 0,
  });

  // WebGL context loss guard
  useEffect(() => {
    const onLost = (event: Event) => {
      event.preventDefault();
      latest.current.onFallback?.();
    };
    gl.domElement.addEventListener("webglcontextlost", onLost);
    return () => gl.domElement.removeEventListener("webglcontextlost", onLost);
  }, [gl]);

  // Build hero procedural Avatar rig once
  useEffect(() => {
    const holder = faceHolderRef.current;
    if (!holder) return;
    const rig = createAvatarRig(latest.current.avatarColor);
    avatarRigRef.current = rig;
    holder.add(rig.root);
    return () => {
      holder.remove(rig.root);
      avatarRigRef.current = null;
    };
  }, []);

  // Initialize Rapier 3D physics world once
  useEffect(() => {
    let alive = true;
    void import("@dimforge/rapier3d-compat")
      .then(async (R) => {
        await R.init();
        if (!alive) return;
        const world = new R.World({ x: 0, y: -11.5, z: 0 });
        // Circular arena floor collider
        world.createCollider(R.ColliderDesc.cylinder(0.25, 3.6).setTranslation(0, -0.25, 0));
        // Invisible ring boundary pillars to keep bouncing pieces on stage
        const wallCount = 12;
        for (let i = 0; i < wallCount; i++) {
          const angle = (i / wallCount) * Math.PI * 2;
          const x = Math.cos(angle) * 3.35;
          const z = Math.sin(angle) * 3.35;
          const desc = R.ColliderDesc.cuboid(0.95, 2.6, 0.18)
            .setTranslation(x, 2.2, z)
            .setRotation({
              x: 0,
              y: Math.sin((-angle + Math.PI / 2) / 2),
              z: 0,
              w: Math.cos((-angle + Math.PI / 2) / 2),
            });
          world.createCollider(desc);
        }
        rapierRef.current = { R, world };
      })
      .catch(() => {
        // Fallback kinematic physics still runs cleanly without Rapier.
      });

    return () => {
      alive = false;
      const current = rapierRef.current;
      rapierRef.current = null;
      if (current) {
        try {
          current.world.free();
        } catch {
          // Ignore double-free on hot reload.
        }
      }
    };
  }, []);

  // Build podium winners when stage === "result"
  useEffect(() => {
    const holder = podiumGroupRef.current;
    if (!holder) return;
    // Clear previous podium avatars
    for (const group of podiumAvatarsRef.current) holder.remove(group);
    podiumAvatarsRef.current = [];
    if (props.stage !== "result") return;

    const top3 = props.roster.slice(0, 3);
    const positions: [number, number, number][] = [
      [0, 1.95, 0],
      [-1.55, 1.45, 0.15],
      [1.55, 1.15, 0.15],
    ];
    top3.forEach((player, idx) => {
      const rig = createAvatarRig(player.color);
      rig.fuseGroup.visible = false;
      rig.root.scale.setScalar(idx === 0 ? 0.62 : 0.52);
      const pos = positions[idx]!;
      rig.root.position.set(pos[0], pos[1], pos[2]);
      holder.add(rig.root);
      podiumAvatarsRef.current.push(rig.root);
    });
  }, [props.stage, props.roster]);

  function clearPieces() {
    const group = dynamicGroupRef.current;
    const phys = rapierRef.current;
    for (const piece of piecesRef.current) {
      group?.remove(piece.mesh);
      piece.mesh.geometry.dispose();
      (piece.mesh.material as THREE.Material).dispose();
      if (piece.body && phys) {
        try {
          phys.world.removeRigidBody(piece.body);
        } catch {
          // ignore
        }
      }
    }
    piecesRef.current = [];
  }

  function spawnPiece(options: {
    shape: "sphere" | "box" | "coin" | "shard";
    color: string;
    radius: number;
    pos: [number, number, number];
    vel: [number, number, number];
    ttlMs: number;
  }) {
    const group = dynamicGroupRef.current;
    if (!group) return;
    // Keep max active physics pieces bounded for smooth mobile FPS
    if (piecesRef.current.length >= 42) {
      const oldest = piecesRef.current.shift();
      if (oldest) {
        group.remove(oldest.mesh);
        oldest.mesh.geometry.dispose();
        (oldest.mesh.material as THREE.Material).dispose();
        if (oldest.body && rapierRef.current) {
          try {
            rapierRef.current.world.removeRigidBody(oldest.body);
          } catch {
            // ignore
          }
        }
      }
    }

    const r = options.radius;
    const geometry =
      options.shape === "sphere"
        ? new THREE.SphereGeometry(r, 18, 16)
        : options.shape === "coin"
          ? new THREE.CylinderGeometry(r, r, r * 0.28, 16)
          : options.shape === "shard"
            ? new THREE.OctahedronGeometry(r, 0)
            : new THREE.BoxGeometry(r * 1.6, r * 1.6, r * 1.6);

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(options.color),
      roughness: options.shape === "coin" ? 0.18 : 0.25,
      metalness: options.shape === "coin" ? 0.65 : 0.12,
      emissive:
        options.shape === "shard" ? new THREE.Color(options.color) : new THREE.Color(0x000000),
      emissiveIntensity: options.shape === "shard" ? 0.35 : 0,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(options.pos[0], options.pos[1], options.pos[2]);
    group.add(mesh);

    let body: RapierBody | null = null;
    if (rapierRef.current) {
      const { R, world } = rapierRef.current;
      const bodyDesc = R.RigidBodyDesc.dynamic()
        .setTranslation(options.pos[0], options.pos[1], options.pos[2])
        .setLinvel(options.vel[0], options.vel[1], options.vel[2])
        .setAngvel({
          x: (Math.random() - 0.5) * 6,
          y: (Math.random() - 0.5) * 6,
          z: (Math.random() - 0.5) * 6,
        });
      body = world.createRigidBody(bodyDesc);
      const colliderDesc =
        options.shape === "sphere"
          ? R.ColliderDesc.ball(r).setRestitution(0.62).setFriction(0.35)
          : R.ColliderDesc.cuboid(r * 0.8, r * 0.8, r * 0.8)
              .setRestitution(0.52)
              .setFriction(0.4);
      world.createCollider(colliderDesc, body);
    }

    piecesRef.current.push({
      mesh,
      body,
      vel: new THREE.Vector3(options.vel[0], options.vel[1], options.vel[2]),
      rotVel: new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 5,
      ),
      bornAt: performance.now(),
      ttlMs: options.ttlMs,
    });
  }

  function triggerBurst(kind: Snap3dLiveState["burstKind"], colorHex: string) {
    if (kind === "paint") {
      // Launch hero paint sphere + celebratory mini droplets
      spawnPiece({
        shape: "sphere",
        color: colorHex,
        radius: 0.42,
        pos: [0, 3.4, 0.8],
        vel: [(Math.random() - 0.5) * 1.4, -2.5, -1.6],
        ttlMs: 8000,
      });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        spawnPiece({
          shape: "sphere",
          color: colorHex,
          radius: 0.16,
          pos: [Math.cos(a) * 0.4, 2.2, Math.sin(a) * 0.4],
          vel: [Math.cos(a) * 2.8, 3.2, Math.sin(a) * 2.8],
          ttlMs: 4200,
        });
      }
      return;
    }
    if (kind === "capture") {
      for (let i = 0; i < 5; i++) {
        spawnPiece({
          shape: i === 0 ? "box" : "coin",
          color: i === 0 ? "#0A84FE" : "#FACC15",
          radius: i === 0 ? 0.34 : 0.22,
          pos: [(Math.random() - 0.5) * 1.2, 3.6 + i * 0.35, (Math.random() - 0.5) * 1.2],
          vel: [(Math.random() - 0.5) * 1.6, -1.5, (Math.random() - 0.5) * 1.6],
          ttlMs: 7500,
        });
      }
      return;
    }
    if (kind === "pop") {
      const palette = ["#EF4444", "#F97316", "#FACC15", "#FFFFFF", colorHex];
      for (let i = 0; i < 18; i++) {
        const theta = Math.random() * Math.PI * 2;
        const speed = 3.2 + Math.random() * 4.5;
        spawnPiece({
          shape: "shard",
          color: palette[i % palette.length]!,
          radius: 0.16 + Math.random() * 0.12,
          pos: [0, 1.5, 0],
          vel: [Math.cos(theta) * speed, 2.6 + Math.random() * 4.2, Math.sin(theta) * speed],
          ttlMs: 5500,
        });
      }
      return;
    }
    // confetti
    const palette = ["#0A84FE", "#FACC15", "#EC4899", "#14B8A6", "#8B5CF6"];
    for (let i = 0; i < 4; i++) {
      spawnPiece({
        shape: i % 2 === 0 ? "coin" : "box",
        color: palette[Math.floor(Math.random() * palette.length)]!,
        radius: 0.16,
        pos: [(Math.random() - 0.5) * 3.2, 4.4, (Math.random() - 0.5) * 2.4],
        vel: [(Math.random() - 0.5) * 1.2, -1.2, (Math.random() - 0.5) * 1.2],
        ttlMs: 5500,
      });
    }
  }

  // Cleanup all meshes on unmount
  useEffect(() => () => clearPieces(), []);

  useFrame((state, delta) => {
    const dt = Math.min(0.04, Math.max(0.001, delta));
    const t = state.clock.elapsedTime;
    const now = performance.now();
    const { stage, mission, lastResult, liveRef, avatarColor } = latest.current;
    const live = liveRef.current;

    // 1. Trigger bursts from external live events
    if (live && live.burstCounter !== lastBurstRef.current) {
      lastBurstRef.current = live.burstCounter;
      triggerBurst(live.burstKind, live.burstColor);
    }

    // 2. Drop all players' captured 3D balls/cubes on reveal
    const revealKey = stage === "reveal" && lastResult ? `${lastResult.round}:${stage}` : "";
    if (revealKey && revealKey !== lastRevealKeyRef.current) {
      lastRevealKeyRef.current = revealKey;
      clearPieces();
      if (lastResult?.mission.kind === "color") {
        lastResult.entries.slice(0, 10).forEach((entry, i) => {
          if (!entry.hex) return;
          const angle = (i / Math.max(1, lastResult.entries.length)) * Math.PI * 2;
          spawnPiece({
            shape: "sphere",
            color: entry.hex,
            radius: entry.rank === 1 ? 0.44 : 0.32,
            pos: [Math.cos(angle) * 1.1, 3.2 + i * 0.25, Math.sin(angle) * 1.1],
            vel: [-Math.cos(angle) * 0.8, -1.2, -Math.sin(angle) * 0.8],
            ttlMs: 9000,
          });
        });
      } else if (lastResult) {
        lastResult.entries.slice(0, 8).forEach((entry, i) => {
          if (entry.points <= 0) return;
          spawnPiece({
            shape: entry.rank === 1 ? "coin" : "box",
            color: entry.rank === 1 ? "#FACC15" : entry.color,
            radius: 0.28,
            pos: [(Math.random() - 0.5) * 1.8, 3.4 + i * 0.3, (Math.random() - 0.5) * 1.8],
            vel: [(Math.random() - 0.5) * 1.5, -1.4, (Math.random() - 0.5) * 1.5],
            ttlMs: 9000,
          });
        });
      }
    } else if (stage === "briefing" && lastRevealKeyRef.current) {
      lastRevealKeyRef.current = "";
      clearPieces();
    }

    // 3. Continuous celebratory confetti on final 3D podium
    if (stage === "result" && now - lastPodiumSpawnRef.current > 650) {
      lastPodiumSpawnRef.current = now;
      triggerBurst("confetti", "#FACC15");
    }

    // 4. Step Rapier 3D physics world (or kinematic fallback)
    if (rapierRef.current) {
      rapierRef.current.world.timestep = dt;
      rapierRef.current.world.step();
    }
    const group = dynamicGroupRef.current;
    for (let i = piecesRef.current.length - 1; i >= 0; i--) {
      const piece = piecesRef.current[i]!;
      if (now - piece.bornAt > piece.ttlMs) {
        group?.remove(piece.mesh);
        piece.mesh.geometry.dispose();
        (piece.mesh.material as THREE.Material).dispose();
        if (piece.body && rapierRef.current) {
          try {
            rapierRef.current.world.removeRigidBody(piece.body);
          } catch {
            // ignore
          }
        }
        piecesRef.current.splice(i, 1);
        continue;
      }
      if (piece.body) {
        const pos = piece.body.translation();
        const rot = piece.body.rotation();
        piece.mesh.position.set(pos.x, pos.y, pos.z);
        piece.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
      } else {
        piece.vel.y -= 11.5 * dt;
        piece.mesh.position.addScaledVector(piece.vel, dt);
        if (piece.mesh.position.y < 0.28) {
          piece.mesh.position.y = 0.28;
          piece.vel.y = Math.abs(piece.vel.y) * 0.55;
          piece.vel.x *= 0.86;
          piece.vel.z *= 0.86;
        }
        piece.mesh.rotation.x += piece.rotVel.x * dt;
        piece.mesh.rotation.y += piece.rotVel.y * dt;
      }
    }

    // 5. Smooth telemetry interpolation
    const face = live?.face ?? NEUTRAL_FACE_TELEMETRY;
    const ease = Math.min(1, dt * 12);
    const s = smooth.current;
    s.smile += (face.smile - s.smile) * ease;
    s.jawOpen += (face.jawOpen - s.jawOpen) * ease;
    s.winkLeft += (face.winkLeft - s.winkLeft) * ease;
    s.winkRight += (face.winkRight - s.winkRight) * ease;
    s.browDown += (face.browDown - s.browDown) * ease;
    s.pucker += (face.pucker - s.pucker) * ease;
    s.headYaw += (face.headYaw - s.headYaw) * ease;
    s.headPitch += (face.headPitch - s.headPitch) * ease;
    s.headRoll += (face.headRoll - s.headRoll) * ease;
    s.tension += ((live?.tension ?? 0) - s.tension) * Math.min(1, dt * 9);
    s.lock += ((live?.lockProgress ?? 0) - s.lock) * Math.min(1, dt * 14);

    // 6. Subtle studio background tint based on smile-bomb danger
    const danger =
      mission?.kind === "face" && mission.subMode === "smile-bomb" && stage === "active"
        ? Math.min(1, s.tension / 100)
        : 0;
    const bgColor = new THREE.Color("#edf5ff").lerp(new THREE.Color("#ffe7e7"), danger * 0.85);
    scene.background = bgColor;

    // 7. Update Color Sniper hero 3D crystal & live orb
    if (colorGroupRef.current) {
      const showColor = stage !== "result" && mission?.kind === "color";
      colorGroupRef.current.visible = showColor;
      if (showColor && mission?.kind === "color") {
        if (targetCrystalRef.current) {
          targetCrystalRef.current.rotation.y = t * 0.9;
          targetCrystalRef.current.rotation.x = Math.sin(t * 1.1) * 0.25;
          targetCrystalRef.current.position.y = 1.85 + Math.sin(t * 2.2) * 0.14;
          (targetCrystalRef.current.material as THREE.MeshStandardMaterial).color.set(
            mission.targetHex,
          );
        }
        if (targetRingRef.current) {
          targetRingRef.current.rotation.z = -t * 0.65;
          targetRingRef.current.position.y = 1.85 + Math.sin(t * 2.2) * 0.14;
        }
        if (sampleOrbRef.current) {
          const acc = (live?.colorAccuracy ?? 0) / 100;
          const pulse = 1 + acc * 0.35 + Math.sin(t * 7) * acc * 0.06;
          sampleOrbRef.current.scale.setScalar(pulse);
          sampleOrbRef.current.position.y = 0.65 + Math.cos(t * 3) * 0.05;
          (sampleOrbRef.current.material as THREE.MeshStandardMaterial).color.set(
            live?.sampleHex || "#94A3B8",
          );
        }
      }
    }

    // 8. Update Table Hunter hero 3D capture box & tractor beam
    if (objectGroupRef.current) {
      const showObject = stage !== "result" && mission?.kind === "object";
      objectGroupRef.current.visible = showObject;
      if (showObject) {
        const lock = s.lock;
        if (crateRef.current) {
          crateRef.current.rotation.y = t * (0.8 + lock * 4.2);
          crateRef.current.rotation.x = Math.sin(t * 1.8) * 0.22;
          crateRef.current.position.y = 1.65 + Math.sin(t * 2.6) * 0.16;
          const mat = crateRef.current.material as THREE.MeshStandardMaterial;
          mat.color.set(lock > 0.15 ? "#0A84FE" : "#3B82F6");
          mat.emissive.set(lock > 0.75 ? "#22C55E" : "#0A84FE");
          mat.emissiveIntensity = 0.2 + lock * 1.1;
        }
        if (beamRef.current) {
          beamRef.current.scale.set(0.75 + lock * 0.55, 1, 0.75 + lock * 0.55);
          (beamRef.current.material as THREE.MeshBasicMaterial).opacity = 0.12 + lock * 0.42;
        }
        if (radarRingRef.current) {
          radarRingRef.current.rotation.z = t * (1.2 + lock * 5.0);
          const ringScale = 1 + lock * 0.3;
          radarRingRef.current.scale.set(ringScale, ringScale, 1);
        }
      }
    }

    // 9. Update 3D Pokerface / Balloon Avatar
    if (faceHolderRef.current && avatarRigRef.current) {
      const showFace = stage !== "result" && mission?.kind === "face";
      const popped = !!live?.popped && mission?.kind === "face" && mission.subMode === "smile-bomb";
      faceHolderRef.current.visible = showFace && !popped;
      if (showFace && !popped && mission?.kind === "face") {
        const rig = avatarRigRef.current;
        const isBomb = mission.subMode === "smile-bomb";
        rig.fuseGroup.visible = isBomb;
        const pct = isBomb ? Math.min(1, s.tension / 100) : 0;
        const inflate = 1 + pct * 0.58;
        const jitter = pct > 0.35 ? Math.sin(t * 46) * (pct - 0.35) * 0.12 : 0;
        rig.root.position.set(jitter, 1.48 + Math.sin(t * 2.4) * 0.08, 0);
        rig.root.scale.setScalar(inflate);

        // Live head tracking
        rig.head.rotation.y = s.headYaw * 0.55;
        rig.head.rotation.x = s.headPitch * 0.42;
        rig.head.rotation.z = -s.headRoll * 0.38;

        // Color shifts cool -> amber -> danger red as tension rises
        const base = new THREE.Color(avatarColor);
        const warn = new THREE.Color("#F59E0B");
        const hot = new THREE.Color("#EF4444");
        const targetColor =
          pct < 0.5 ? base.clone().lerp(warn, pct * 2) : warn.clone().lerp(hot, (pct - 0.5) * 2);
        rig.headMat.color.copy(targetColor);
        rig.headMat.emissive.copy(hot);
        rig.headMat.emissiveIntensity = pct > 0.5 ? (pct - 0.5) * 0.9 : 0;

        // Spark pulse
        if (isBomb) {
          const sparkScale = 0.8 + pct * 1.1 + Math.sin(t * 24) * 0.25;
          rig.spark.scale.setScalar(sparkScale);
          rig.spark.rotation.y = t * 6;
        }

        // Blendshape facial expressions
        rig.leftEye.scale.y = Math.max(0.14, 1 - s.winkLeft * 0.88 - s.smile * 0.22);
        rig.rightEye.scale.y = Math.max(0.14, 1 - s.winkRight * 0.88 - s.smile * 0.22);

        const browLift = s.jawOpen * 0.12 - s.browDown * 0.14;
        rig.leftBrow.position.y = 0.39 + browLift;
        rig.rightBrow.position.y = 0.39 + browLift;
        rig.leftBrow.rotation.z = -s.browDown * 0.45 + s.jawOpen * 0.18;
        rig.rightBrow.rotation.z = s.browDown * 0.45 - s.jawOpen * 0.18;

        const mouthWidth = Math.max(0.55, 1 + s.smile * 0.85 - s.pucker * 0.55);
        const mouthHeight = Math.max(0.45, 0.75 + s.jawOpen * 2.1 + s.pucker * 0.55);
        rig.mouth.scale.set(mouthHeight, mouthWidth, 1);
        rig.mouth.position.y = -0.26 - s.jawOpen * 0.08 + s.smile * 0.04;

        const cheekBoost = 1 + s.smile * 0.45;
        rig.leftCheek.scale.set(1.2 * cheekBoost, 0.68 * cheekBoost, 0.45);
        rig.rightCheek.scale.set(1.2 * cheekBoost, 0.68 * cheekBoost, 0.45);
      }
    }

    // 10. Animate 3D Podium Finale
    if (podiumGroupRef.current) {
      podiumGroupRef.current.visible = stage === "result";
      if (stage === "result") {
        podiumAvatarsRef.current.forEach((avatar, idx) => {
          const baseY = idx === 0 ? 1.95 : idx === 1 ? 1.45 : 1.15;
          avatar.position.y =
            baseY + Math.abs(Math.sin(t * 3.4 + idx * 1.1)) * (idx === 0 ? 0.34 : 0.2);
          avatar.rotation.y = Math.sin(t * 1.8 + idx) * 0.45;
        });
        if (crownRef.current) {
          crownRef.current.rotation.y = t * 2.0;
          crownRef.current.position.y = 2.95 + Math.sin(t * 3.4) * 0.16;
        }
      }
    }

    // Subtle idle rotation on arena neon rim
    if (arenaRef.current) {
      arenaRef.current.rotation.y = Math.sin(t * 0.35) * 0.08;
    }
  });

  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight position={[4.5, 8.5, 6]} intensity={1.15} castShadow />
      <pointLight position={[-4, 4, -3]} intensity={0.55} color="#7dd3fc" />
      <pointLight position={[4, 3, -3]} intensity={0.45} color="#f472b6" />

      {/* Circular Sliper 3D Arena Floor */}
      <group ref={arenaRef}>
        <mesh position={[0, -0.2, 0]} receiveShadow>
          <cylinderGeometry args={[3.55, 3.7, 0.4, 40]} />
          <meshStandardMaterial color="#ffffff" roughness={0.35} metalness={0.05} />
        </mesh>
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[3.22, 3.5, 48]} />
          <meshStandardMaterial
            color="#0A84FE"
            emissive="#0A84FE"
            emissiveIntensity={0.45}
            roughness={0.2}
          />
        </mesh>
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.65, 1.72, 40]} />
          <meshBasicMaterial color="#dbeafe" />
        </mesh>
      </group>

      {/* Hero 1: Color Sniper 3D Crystal & Sample Orb */}
      <group ref={colorGroupRef} visible={false}>
        <mesh ref={targetCrystalRef} position={[0, 1.85, 0]} castShadow>
          <octahedronGeometry args={[0.78, 0]} />
          <meshStandardMaterial color="#0A84FE" roughness={0.18} metalness={0.22} />
        </mesh>
        <mesh ref={targetRingRef} position={[0, 1.85, 0]} rotation={[Math.PI / 3, 0, 0]}>
          <torusGeometry args={[1.18, 0.055, 14, 44]} />
          <meshStandardMaterial
            color="#ffffff"
            emissive="#0A84FE"
            emissiveIntensity={0.5}
            roughness={0.2}
          />
        </mesh>
        <mesh ref={sampleOrbRef} position={[0, 0.65, 1.2]} castShadow>
          <sphereGeometry args={[0.38, 22, 18]} />
          <meshStandardMaterial color="#94A3B8" roughness={0.2} metalness={0.12} />
        </mesh>
      </group>

      {/* Hero 2: Table Hunter 3D Capture Crate & Tractor Beam */}
      <group ref={objectGroupRef} visible={false}>
        <mesh ref={crateRef} position={[0, 1.65, 0]} castShadow>
          <boxGeometry args={[1.05, 1.05, 1.05]} />
          <meshStandardMaterial color="#0A84FE" roughness={0.22} metalness={0.25} />
        </mesh>
        <mesh ref={beamRef} position={[0, 0.88, 0]}>
          <coneGeometry args={[1.25, 1.7, 28, 1, true]} />
          <meshBasicMaterial
            color="#38BDF8"
            transparent
            opacity={0.22}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
        <mesh ref={radarRingRef} position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.05, 1.24, 36]} />
          <meshBasicMaterial color="#0A84FE" transparent opacity={0.8} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Hero 3: 3D Pokerface / Balloon Avatar */}
      <group ref={faceHolderRef} visible={false} />

      {/* Finale: 3D Podium */}
      <group ref={podiumGroupRef} visible={false}>
        {/* 1st place pedestal */}
        <mesh position={[0, 0.68, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.25, 1.36, 1.25]} />
          <meshStandardMaterial color="#FACC15" roughness={0.28} metalness={0.35} />
        </mesh>
        {/* 2nd place pedestal */}
        <mesh position={[-1.55, 0.48, 0.15]} castShadow receiveShadow>
          <boxGeometry args={[1.15, 0.96, 1.15]} />
          <meshStandardMaterial color="#CBD5E1" roughness={0.3} metalness={0.35} />
        </mesh>
        {/* 3rd place pedestal */}
        <mesh position={[1.55, 0.34, 0.15]} castShadow receiveShadow>
          <boxGeometry args={[1.15, 0.68, 1.15]} />
          <meshStandardMaterial color="#F59E0B" roughness={0.35} metalness={0.25} />
        </mesh>
        {/* Rotating golden crown above 1st place */}
        <mesh ref={crownRef} position={[0, 2.95, 0]} castShadow>
          <torusGeometry args={[0.38, 0.11, 10, 6]} />
          <meshStandardMaterial
            color="#FDE047"
            emissive="#F59E0B"
            emissiveIntensity={0.45}
            metalness={0.75}
            roughness={0.18}
          />
        </mesh>
      </group>

      {/* Rapier Physics Dynamic Group */}
      <group ref={dynamicGroupRef} />
    </>
  );
}

export function SnapPang3dStage(props: Props) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "grid",
          placeItems: "center",
          background: "linear-gradient(135deg, #eaf4ff 0%, #f8fafc 100%)",
          color: "#334155",
          textAlign: "center",
          padding: 16,
          fontSize: 14,
        }}
      >
        <div>
          <strong>3D 무대 간소화 모드</strong>
          <p style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
            이 기기의 WebGL 제한으로 2D 경량 모드로 계속 플레이해요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <SceneBoundary
      onFail={() => {
        setFailed(true);
        props.onFallback?.();
      }}
    >
      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{ position: [0, 3.6, 6.2], fov: 42, near: 0.1, far: 60 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        style={{ width: "100%", height: "100%" }}
      >
        <ArenaWorld {...props} onFallback={() => setFailed(true)} />
      </Canvas>
    </SceneBoundary>
  );
}
