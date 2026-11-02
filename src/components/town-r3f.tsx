"use client";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { createTownScene } from "./town-scene";
import type { TownSnapshot } from "../domain/town";
type Props = {
  read: () => TownSnapshot | null;
  onPlace: (place: "games" | "board") => void;
  onFailure: () => void;
};
class Boundary extends Component<{ children: ReactNode; fail: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.fail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
function Contents(props: Props) {
  const { camera, gl, invalidate, size } = useThree(),
    latest = useRef(props);
  latest.current = props;
  const [world] = useState(() => createTownScene(camera, () => latest.current.read()));
  useEffect(() => {
    const loss = (e: Event) => {
      e.preventDefault();
      latest.current.onFailure();
    };
    gl.domElement.addEventListener("webglcontextlost", loss);
    return () => {
      gl.domElement.removeEventListener("webglcontextlost", loss);
      world.dispose();
    };
  }, [world, gl]);
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setInterval(
      () => {
        if (!document.hidden) invalidate();
      },
      reduced ? 66 : size.width < 720 ? 33 : 16,
    );
    return () => clearInterval(timer);
  }, [invalidate, size.width]);
  useFrame(({ clock }) => world.update(clock.elapsedTime * 1000));
  return (
    <primitive
      object={world.scene}
      onClick={(e: { object: import("three").Object3D }) => {
        const place = world.place(e.object);
        if (place) latest.current.onPlace(place);
      }}
    />
  );
}
export function TownScene(props: Props) {
  return (
    <Boundary fail={props.onFailure}>
      <Canvas
        frameloop="demand"
        orthographic
        camera={{ position: [19, 26, 24], zoom: 22, near: 0.1, far: 150 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "low-power" }}
        fallback={<p>3D 화면을 사용할 수 없어요. 2D로 보기 버튼을 눌러주세요.</p>}
        style={{ width: "100%", height: "100%" }}
      >
        <Contents {...props} />
      </Canvas>
    </Boundary>
  );
}
