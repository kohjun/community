// Discard private responses started before a live permission change.
export class RoomAccess {
  private epoch = 0;
  private active = true;
  constructor(
    private canWrite: boolean,
    private isOwner: boolean,
  ) {}
  update(canWrite: boolean, isOwner: boolean) {
    if (this.canWrite !== canWrite || this.isOwner !== isOwner) this.epoch++;
    this.canWrite = canWrite;
    this.isOwner = isOwner;
  }
  revoke() {
    this.active = false;
    this.epoch++;
  }
  ticket() {
    return this.epoch;
  }
  allows(ticket: number, permission: "read" | "write" | "owner" = "read") {
    return (
      this.active &&
      ticket === this.epoch &&
      (permission === "read" || (permission === "write" ? this.canWrite : this.isOwner))
    );
  }
}
