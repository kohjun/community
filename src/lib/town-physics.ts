import { TOWN_OBSTACLES } from "../domain/town";
export function createTownPhysics(R: typeof import("@dimforge/rapier3d-compat")) {
  const world = new R.World({ x: 0, y: 0, z: 0 });
  // Include the character radius and Rapier contact gap inside the server's static collision envelope.
  for (const o of TOWN_OBSTACLES)
    world.createCollider(R.ColliderDesc.cylinder(2, o.radius - 0.28).setTranslation(o.x, 1, o.z));
  const body = world.createRigidBody(
    R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0.9, 11),
  );
  const collider = world.createCollider(R.ColliderDesc.capsule(0.4, 0.3), body),
    controller = world.createCharacterController(0.02);
  return { world, body, collider, controller };
}
