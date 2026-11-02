import { TOWN_SPEED, townWalkable } from "../domain/town";
export class TownMovementValidator {
  private budget = 0.5;
  private stamp: number;
  private velocity = { x: 0, z: 0 };
  private acceptedAt: number;
  constructor(now: number) {
    this.stamp = now;
    this.acceptedAt = now;
  }
  accept(
    from: { x: number; z: number },
    to: { x: number; y: number; z: number },
    input: { x: number; z: number },
    now: number,
  ) {
    this.budget = Math.min(0.6, this.budget + (Math.max(0, now - this.stamp) / 1000) * TOWN_SPEED);
    this.stamp = now;
    const dx = to.x - from.x,
      dz = to.z - from.z,
      distance = Math.hypot(dx, dz);
    if (
      !Number.isFinite(distance) ||
      Math.abs(to.y) > 0.05 ||
      distance > this.budget ||
      !townWalkable(to.x, to.z)
    )
      return false;
    // Validate the swept path, so a valid end point cannot tunnel across a static obstacle.
    const steps = Math.max(1, Math.ceil(distance / 0.15));
    for (let i = 1; i <= steps; i++)
      if (!townWalkable(from.x + (dx * i) / steps, from.z + (dz * i) / steps)) return false;
    if (
      distance > 0.03 &&
      (Math.hypot(input.x, input.z) < 0.01 || dx * input.x + dz * input.z < -0.01)
    )
      return false;
    const dt = Math.max(0.05, (now - this.acceptedAt) / 1000),
      velocity = { x: dx / dt, z: dz / dt };
    if (Math.hypot(velocity.x - this.velocity.x, velocity.z - this.velocity.z) > 180 * dt + 0.25)
      return false;
    this.velocity = velocity;
    this.acceptedAt = now;
    this.budget -= distance;
    return true;
  }
}
