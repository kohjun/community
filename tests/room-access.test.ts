import assert from "node:assert/strict";
import test from "node:test";
import { RoomAccess } from "../src/lib/room-access";
test("in-flight attendee responses cannot restore contacts after staff revocation", () => {
  const access = new RoomAccess(true, false),
    oldRequest = access.ticket();
  access.update(false, false);
  assert.equal(access.allows(oldRequest, "write"), false);
  assert.equal(access.allows(oldRequest), false);
  const participantRequest = access.ticket();
  assert.equal(access.allows(participantRequest), true);
  assert.equal(access.allows(participantRequest, "write"), false);
});
test("refund or unmount discards pending room requests even if a new role is later granted", () => {
  const access = new RoomAccess(true, true),
    request = access.ticket();
  access.revoke();
  access.update(true, true);
  assert.equal(access.allows(request), false);
  assert.equal(access.allows(access.ticket(), "owner"), false);
});
