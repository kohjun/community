import assert from "node:assert/strict";
import test from "node:test";
import { createLocationRequests } from "../src/lib/location-request";

test("cancelled and replaced location attempts cannot overwrite a later manual choice", async () => {
  const requests = createLocationRequests();
  const cancelled = requests.begin();
  requests.cancel();
  assert.equal(await cancelled.result, null);
  assert.equal(cancelled.isCurrent(), false);
  assert.equal(cancelled.complete({ latitude: 37.1, longitude: 127.1 }), false);

  const replaced = requests.begin();
  const newest = requests.begin();
  assert.equal(await replaced.result, null);
  assert.equal(replaced.complete({ latitude: 37.2, longitude: 127.2 }), false);
  assert.equal(newest.isCurrent(), true);
  const selected = { latitude: 0, longitude: 0 };
  assert.equal(newest.complete(selected), true);
  assert.deepEqual(await newest.result, selected);
  assert.equal(newest.complete({ latitude: 37.3, longitude: 127.3 }), false);

  const unmounted = requests.begin();
  requests.cancel();
  assert.equal(await unmounted.result, null);
  assert.equal(unmounted.complete({ latitude: 37.4, longitude: 127.4 }), false);
});
