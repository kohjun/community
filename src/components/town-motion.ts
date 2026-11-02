"use client";
import { createTownPhysics } from "../lib/town-physics";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { TownSnapshot, TownInput } from "../domain/town";
import { TOWN_BOUNDS, TOWN_SPEED } from "../domain/town";
export function useTownMotion(
  active: boolean,
  view: RefObject<TownSnapshot | null>,
  input: RefObject<{ x: number; z: number }>,
  correction: RefObject<{ x: number; z: number; sequence: number } | null>,
  send: (input: TownInput) => void,
  retry = 0,
) {
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const position = useRef<{ x: number; z: number; yaw: number } | null>(null),
    sender = useRef(send);
  sender.current = send;
  useEffect(() => {
    setReady(false);
    setError("");
    if (!active) return;
    let alive = true,
      cleanup: (() => void) | undefined;
    void import("@dimforge/rapier3d-compat")
      .then(async (R) => {
        await R.init();
        if (!alive) return;
        const { world, body, collider, controller } = createTownPhysics(R);
        let id = "",
          sequence = 0,
          last = performance.now(),
          report = 0,
          wasSeated = false;

        setReady(true);
        let vx = 0,
          vz = 0;
        const timer = setInterval(() => {
          const v = view.current,
            me = v?.players.find((p) => p.id === v.me),
            now = performance.now();
          if (!me) {
            last = now;
            return;
          }
          if (me.id !== id) {
            id = me.id;
            sequence = 0;

            body.setTranslation({ x: me.x, y: 0.9, z: me.z }, true);
          }
          if (correction.current) {
            const fix = correction.current;
            vx = 0;
            vz = 0;
            correction.current = null;
            body.setTranslation({ x: fix.x, y: 0.9, z: fix.z }, true);
          }
          if (me.seat || wasSeated) {
            body.setTranslation({ x: me.x, y: 0.9, z: me.z }, true);
            wasSeated = !!me.seat;
          }
          const dt = Math.min(0.033, Math.max(0.001, (now - last) / 1000));
          last = now;
          const p = body.translation(),
            len = Math.max(1, Math.hypot(input.current.x, input.current.z)),
            ix = me.seat ? 0 : input.current.x / len,
            iz = me.seat ? 0 : input.current.z / len;
          const ease = Math.min(1, dt * 12);
          vx += (ix * TOWN_SPEED - vx) * ease;
          vz += (iz * TOWN_SPEED - vz) * ease;
          controller.computeColliderMovement(collider, {
            x: vx * dt,
            y: 0,
            z: vz * dt,
          });
          const delta = controller.computedMovement(),
            next = {
              x: Math.max(-TOWN_BOUNDS, Math.min(TOWN_BOUNDS, p.x + delta.x)),
              y: 0.9,
              z: Math.max(-TOWN_BOUNDS, Math.min(TOWN_BOUNDS, p.z + delta.z)),
            };
          body.setNextKinematicTranslation(next);
          world.timestep = dt;
          world.step();
          const yaw =
            Math.hypot(ix, iz) > 0.01 ? Math.atan2(ix, iz) : (position.current?.yaw ?? me.yaw);
          position.current = { x: next.x, z: next.z, yaw };
          if (now - report >= 50) {
            report = now;
            sequence++;
            sender.current({
              type: "input",
              sequence,
              moveX: Math.abs(vx) > 0.01 ? vx / TOWN_SPEED : 0,
              moveZ: Math.abs(vz) > 0.01 ? vz / TOWN_SPEED : 0,
              rotationY: yaw,
              clientTick: Math.floor(now),
            });
            sender.current({
              type: "report",
              sequence,
              position: { x: next.x, y: 0, z: next.z },
              rotationY: yaw,
            });
          }
        }, 16);
        cleanup = () => {
          clearInterval(timer);
          world.free();
          position.current = null;
        };
      })
      .catch(() => {
        position.current = null;
        setReady(false);
        setError("이동 기능을 불러오지 못했어요. 다시 연결해주세요.");
      });
    return () => {
      alive = false;
      cleanup?.();
    };
  }, [active, view, input, correction, retry]);
  return { position, ready, error };
}
