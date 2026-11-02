export class TownAOI {
  private cells = new Map<string, Set<string>>();
  private locations = new Map<string, { x: number; z: number; cell: string }>();
  constructor(readonly size = 25) {}
  update(id: string, x: number, z: number) {
    const cell = `${Math.floor(x / this.size)}:${Math.floor(z / this.size)}`,
      previous = this.locations.get(id);
    if (previous?.cell !== cell) {
      if (previous) {
        const old = this.cells.get(previous.cell);
        old?.delete(id);
        if (!old?.size) this.cells.delete(previous.cell);
      }
      let bucket = this.cells.get(cell);
      if (!bucket) {
        bucket = new Set();
        this.cells.set(cell, bucket);
      }
      bucket.add(id);
    }
    this.locations.set(id, { x, z, cell });
  }
  remove(id: string) {
    const old = this.locations.get(id);
    if (!old) return;
    const bucket = this.cells.get(old.cell);
    bucket?.delete(id);
    if (!bucket?.size) this.cells.delete(old.cell);
    this.locations.delete(id);
  }
  nearby(x: number, z: number, radius: number) {
    const out: string[] = [],
      cx = Math.floor(x / this.size),
      cz = Math.floor(z / this.size),
      range = Math.ceil(radius / this.size);
    for (let dx = -range; dx <= range; dx++)
      for (let dz = -range; dz <= range; dz++)
        for (const id of this.cells.get(`${cx + dx}:${cz + dz}`) ?? []) {
          const p = this.locations.get(id)!;
          if ((p.x - x) ** 2 + (p.z - z) ** 2 <= radius ** 2) out.push(id);
        }
    return out;
  }
}
export function townVoiceTargets(
  me: { x: number; z: number },
  candidates: { id: string; x: number; z: number; online: boolean }[],
  previous: ReadonlySet<string> = new Set(),
) {
  return candidates
    .filter((p) => p.online && Math.hypot(p.x - me.x, p.z - me.z) <= (previous.has(p.id) ? 18 : 15))
    .sort(
      (a, b) =>
        Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 12)
    .map((p) => p.id);
}
