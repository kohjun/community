import * as THREE from "three";
import { TOWN_SEATS, type TownAvatar, type TownSnapshot } from "../domain/town";
type Model = {
  group: THREE.Group;
  left: THREE.Group;
  right: THREE.Group;
  legA: THREE.Mesh;
  legB: THREE.Mesh;
  label: THREE.Sprite;
  name: string;
};
const colors = [0x0a84fe, 0xf28a61, 0x8b78d5, 0x42a68d, 0xe9ad45, 0xcd7b9a];
export function createTownScene(camera: THREE.Camera, read: () => TownSnapshot | null) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xccecf3);
  scene.fog = new THREE.Fog(0xccecf3, 45, 85);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x91a58a, 2.5));
  const sun = new THREE.DirectionalLight(0xfff1d7, 3);
  sun.position.set(-12, 24, 8);
  scene.add(sun);
  const mats = new Map<number, THREE.MeshStandardMaterial>(),
    geo = new Set<THREE.BufferGeometry>(),
    textures = new Set<THREE.Texture>(),
    spriteMaterials = new Set<THREE.SpriteMaterial>();
  const mat = (c: number) => {
    let m = mats.get(c);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });
      mats.set(c, m);
    }
    return m;
  };
  function mesh(
    g: THREE.BufferGeometry,
    c: number,
    x = 0,
    y = 0,
    z = 0,
    parent: THREE.Object3D = scene,
  ) {
    geo.add(g);
    const m = new THREE.Mesh(g, mat(c));
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  function box(
    w: number,
    h: number,
    d: number,
    c: number,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = scene,
  ) {
    return mesh(new THREE.BoxGeometry(w, h, d), c, x, y, z, parent);
  }
  function cylinder(
    r: number,
    h: number,
    c: number,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = scene,
  ) {
    return mesh(new THREE.CylinderGeometry(r, r, h, 24), c, x, y, z, parent);
  }
  function sphere(
    r: number,
    c: number,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = scene,
  ) {
    return mesh(new THREE.SphereGeometry(r, 12, 8), c, x, y, z, parent);
  }
  function label(text: string, x: number, y: number, z: number, large = false) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgba(255,255,255,.95)";
    ctx.beginPath();
    ctx.roundRect(6, 14, 500, 98, 28);
    ctx.fill();
    ctx.fillStyle = "#20334b";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "600 36px Pretendard, sans-serif";
    ctx.fillText(text, 256, 66, 470);
    const texture = new THREE.CanvasTexture(canvas);
    textures.add(texture);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    spriteMaterials.add(material);
    const sprite = new THREE.Sprite(material);
    sprite.position.set(x, y, z);
    sprite.scale.set(large ? 5 : 3.4, large ? 1.25 : 0.85, 1);
    sprite.renderOrder = 2;
    return sprite;
  }
  box(500, 0.3, 500, 0x89c8a0, 0, -0.35, 0);
  box(31, 0.25, 31, 0xf1e3c8, 0, -0.12, 0);
  // Small paving accents avoid heavy textures and external assets.
  for (let x = -14; x <= 14; x += 2)
    for (let z = -14; z <= 14; z += 2)
      if ((x + z) % 4 === 0) box(1.94, 0.015, 1.94, 0xebdcbd, x, 0.015, z);
  cylinder(2.7, 0.5, 0xfbf6e9, 0, 0.25, 0);
  cylinder(2.35, 0.08, 0x72c7ec, 0, 0.53, 0);
  cylinder(1.1, 0.25, 0xe4eaf0, 0, 0.68, 0);
  // A friendly blue slipper sculpture is the meeting landmark.
  const slipper = new THREE.Group();
  slipper.position.set(0, 1.4, 0);
  slipper.rotation.y = -0.4;
  scene.add(slipper);
  const sole = mesh(new THREE.CapsuleGeometry(0.5, 1.4, 6, 12), 0x0a84fe, 0, 0, 0, slipper);
  sole.rotation.x = Math.PI / 2;
  sole.scale.set(1, 0.95, 0.32);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.16, 8, 18, Math.PI), mat(0xfafcff));
  geo.add(strap.geometry);
  strap.rotation.y = Math.PI / 2;
  strap.rotation.z = Math.PI / 2;
  strap.position.set(0, 0.35, 0.15);
  slipper.add(strap);
  scene.add(label("SLIPER TOWN", 0, 3.15, 0, true));
  const targets: THREE.Object3D[] = [];
  const booth = new THREE.Group();
  booth.position.set(-10, 0, -9);
  scene.add(booth);
  box(4.3, 2.8, 3.3, 0xfaf5e9, 0, 1.4, 0, booth);
  box(4.8, 0.45, 3.8, 0x0a84fe, 0, 3, 0, booth);
  box(3.3, 1.3, 0.1, 0xa9d8fa, 0, 1.85, 1.7, booth);
  box(4.5, 0.25, 1, 0xe0c5a2, 0, 1, 1.9, booth);
  const gameSign = label("🎮 게임 라운지", -10, 4, -9, true);
  scene.add(gameSign);
  booth.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.userData.place = "games";
      targets.push(o);
    }
  });
  const board = new THREE.Group();
  board.position.set(10, 0, -9);
  scene.add(board);
  box(0.2, 3, 0.25, 0x987655, -1.4, 1.5, 0, board);
  box(0.2, 3, 0.25, 0x987655, 1.4, 1.5, 0, board);
  box(3.6, 2, 0.25, 0xe6bf87, 0, 2, 0, board);
  for (let i = 0; i < 3; i++)
    box(0.78, 1.1, 0.05, [0xffffff, 0xe8f2ff, 0xfff4d5][i]!, i - 1, 2, 0.16, board);
  scene.add(label("📌 모임 게시판", 10, 4, -9, true));
  board.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.userData.place = "board";
      targets.push(o);
    }
  });
  for (const seat of TOWN_SEATS) {
    const b = new THREE.Group();
    b.position.set(seat.x, 0, seat.z);
    b.rotation.y = seat.yaw;
    scene.add(b);
    box(1.5, 0.18, 0.75, 0xb68c66, 0, 0.6, 0, b);
    box(1.5, 0.65, 0.14, 0xc39b75, 0, 1, -0.38, b);
    box(0.13, 0.6, 0.13, 0x668479, -0.55, 0.3, 0, b);
    box(0.13, 0.6, 0.13, 0x668479, 0.55, 0.3, 0, b);
  }
  for (const x of [-12, 12])
    for (const z of [-3, 5, 11]) {
      cylinder(0.22, 2.5, 0xa8835d, x, 1.25, z);
      sphere(1.6, 0x66ad7e, x, 3.4, z);
      sphere(1.2, 0x86bd84, x + 0.6, 4, z);
      cylinder(1.6, 0.04, 0x77b58b, x, 0.02, z);
    }
  for (const x of [-5, 5])
    for (const z of [-12, 12]) {
      cylinder(0.6, 0.6, 0xeee5d5, x, 0.3, z);
      sphere(0.65, 0x70b283, x, 0.9, z);
      sphere(0.12, 0xf3b8c7, x + 0.3, 1.35, z);
    }
  const avatars = new Map<string, Model>();
  const releaseLabel = (label: THREE.Sprite) => {
    const material = label.material;
    if (material.map) {
      material.map.dispose();
      textures.delete(material.map);
    }
    material.dispose();
    spriteMaterials.delete(material);
    scene.remove(label);
  };
  const releaseAvatar = (model: Model) => {
    model.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        geo.delete(object.geometry);
      }
    });
    scene.remove(model.group);
    releaseLabel(model.label);
  };

  function avatar(a: TownAvatar) {
    const group = new THREE.Group();
    scene.add(group);
    const torso = mesh(
      new THREE.CapsuleGeometry(0.32, 0.52, 4, 10),
      colors[a.color % colors.length]!,
      0,
      1.02,
      0,
      group,
    );
    torso.scale.z = 0.8;
    sphere(0.35, 0xffd7b3, 0, 1.82, 0, group);
    sphere(0.355, 0x55423e, 0, 1.96, -0.05, group);
    sphere(0.035, 0x293546, -0.12, 1.83, 0.305, group);
    sphere(0.035, 0x293546, 0.12, 1.83, 0.305, group);
    const legA = box(0.19, 0.45, 0.22, 0x334b67, -0.16, 0.35, 0, group),
      legB = box(0.19, 0.45, 0.22, 0x334b67, 0.16, 0.35, 0, group);
    box(0.25, 0.12, 0.4, 0xf8fbff, -0.16, 0.1, 0.08, group);
    box(0.25, 0.12, 0.4, 0xf8fbff, 0.16, 0.1, 0.08, group);
    const left = new THREE.Group(),
      right = new THREE.Group();
    left.position.set(-0.43, 1.4, 0);
    right.position.set(0.43, 1.4, 0);
    group.add(left, right);
    mesh(new THREE.CapsuleGeometry(0.105, 0.42, 3, 7), 0xffd7b3, 0, -0.25, 0, left);
    mesh(new THREE.CapsuleGeometry(0.105, 0.42, 3, 7), 0xffd7b3, 0, -0.25, 0, right);
    const tag = label(a.nickname, 0, 2.65, 0);
    scene.add(tag);
    return { group, left, right, legA, legB, label: tag, name: a.nickname };
  }
  const ring = mesh(new THREE.RingGeometry(0.63, 0.73, 32), 0x0a84fe);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  let disposed = false;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const render = (time: number) => {
    if (disposed || document.hidden) return;
    const view = read(),
      seen = new Set<string>(),
      me = view?.players.find((p) => p.id === view.me);
    for (const a of view?.players ?? []) {
      seen.add(a.id);
      let model = avatars.get(a.id);
      if (!model) {
        model = avatar(a);
        model.group.position.set(a.x, 0, a.z);
        avatars.set(a.id, model);
      }
      model.group.position.lerp(new THREE.Vector3(a.x, 0, a.z), reduced ? 1 : 0.35);
      model.group.position.y = a.seat ? -0.35 : 0;
      let diff = a.yaw - model.group.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      model.group.rotation.y += diff * 0.3;
      const walk = a.moving && !reduced ? Math.sin(time * 0.012) * 0.45 : 0;
      model.legA.rotation.x = walk;
      model.legB.rotation.x = -walk;
      model.left.rotation.x = -walk;
      model.right.rotation.x = walk;
      model.right.rotation.z =
        a.wavingUntil > (view?.now ?? 0) ? -2 + Math.sin(time * 0.015) * 0.25 : 0;
      model.label.position.copy(model.group.position).add(new THREE.Vector3(0, 2.65, 0));
      model.group.visible = a.online || Math.floor(time / 500) % 2 === 0;
      model.label.visible = model.group.visible;
      if (model.name !== a.nickname) {
        releaseLabel(model.label);
        model.label = label(a.nickname, 0, 0, 0);
        scene.add(model.label);
        model.name = a.nickname;
      }
    }
    for (const [id, model] of avatars)
      if (!seen.has(id)) {
        releaseAvatar(model);
        avatars.delete(id);
      }
    const target = new THREE.Vector3(me?.x ?? 0, 0, me?.z ?? 0);
    camera.position.copy(target).add(new THREE.Vector3(19, 26, 24));
    camera.lookAt(target);
    ring.visible = !!me;
    ring.position.x = me?.x ?? 0;
    ring.position.z = me?.z ?? 0;
  };
  return {
    scene,
    update: render,
    dispose() {
      disposed = true;
      geo.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      spriteMaterials.forEach((m) => m.dispose());
    },
    place: (object: THREE.Object3D) => object.userData.place as "games" | "board" | undefined,
  };
}
