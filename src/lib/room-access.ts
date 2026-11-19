// Discard private responses started before a live permission change.
export class RoomAccess {
  private epoch = 0;
  private active = true;
  constructor(
    private canManage: boolean,
    private isOwner: boolean,
  ) {}
  update(canManage: boolean, isOwner: boolean) {
    if (this.canManage !== canManage || this.isOwner !== isOwner) this.epoch++;
    this.canManage = canManage;
    this.isOwner = isOwner;
  }
  revoke() {
    this.active = false;
    this.epoch++;
  }
  ticket() {
    return this.epoch;
  }
  allows(ticket: number, permission: "read" | "manage" | "owner" = "read") {
    return (
      this.active &&
      ticket === this.epoch &&
      (permission === "read" || (permission === "manage" ? this.canManage : this.isOwner))
    );
  }
}
