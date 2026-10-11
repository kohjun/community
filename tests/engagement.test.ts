import test from "node:test";
import assert from "node:assert/strict";
import { CATEGORY_SLUGS } from "../src/domain/categories";
import {
  categorySubscriptionsSchema,
  hostSubscriptionSchema,
  inboxQuerySchema,
  inboxReadSchema,
} from "../src/domain/engagement";
test("interest subscriptions accept every supported category and clearing all subscriptions", () => {
  assert.deepEqual(
    categorySubscriptionsSchema.parse({ categories: [...CATEGORY_SLUGS] }).categories,
    CATEGORY_SLUGS,
  );
  assert.deepEqual(categorySubscriptionsSchema.parse({ categories: [] }), { categories: [] });
});
test("interest subscriptions reject duplicates rather than resetting subscription dates", () => {
  assert.equal(
    categorySubscriptionsSchema.safeParse({ categories: ["travel", "travel"] }).success,
    false,
  );
});
test("interest subscriptions reject unknown categories and extra private profile fields", () => {
  for (const value of [
    { categories: ["unknown"] },
    { categories: ["travel"], userId: "private-id" },
    { categories: [], hosts: [] },
  ]) {
    assert.equal(categorySubscriptionsSchema.safeParse(value).success, false);
  }
});
test("host subscription action uses an explicit boolean rather than truthy values", () => {
  assert.deepEqual(hostSubscriptionSchema.parse({ subscribed: false }), { subscribed: false });
  assert.equal(hostSubscriptionSchema.safeParse({ subscribed: "false" }).success, false);
  assert.equal(
    hostSubscriptionSchema.safeParse({ subscribed: true, hostId: "private-id" }).success,
    false,
  );
});
test("unified inbox defaults to a bounded page and validates all source filters", () => {
  assert.deepEqual(inboxQuerySchema.parse({}), { kind: "all", unreadOnly: false, limit: 20 });
  for (const kind of [
    "all",
    "comments",
    "announcements",
    "participation",
    "subscriptions",
    "reminders",
  ]) {
    assert.equal(inboxQuerySchema.parse({ kind, limit: "50" }).kind, kind);
  }
  for (const value of [
    { limit: 0 },
    { limit: 51 },
    { kind: "private" },
    { kind: "all", userId: "other" },
  ]) {
    assert.equal(inboxQuerySchema.safeParse(value).success, false);
  }
});
test("read receipts accept only a UUID of the current user's inbox or all-read action", () => {
  assert.deepEqual(inboxReadSchema.parse({}), {});
  assert.equal(inboxReadSchema.safeParse({ id: "not-an-id" }).success, false);
  assert.equal(inboxReadSchema.safeParse({ recipientId: "other-user" }).success, false);
});

test("unread previews require an explicit true or false query and keep page bounds", () => {
  assert.equal(inboxQuerySchema.parse({ unreadOnly: "true", limit: "6" }).unreadOnly, true);
  assert.equal(inboxQuerySchema.parse({ unreadOnly: "false" }).unreadOnly, false);
  for (const unreadOnly of ["yes", "1", 1, true, ""])
    assert.equal(inboxQuerySchema.safeParse({ unreadOnly }).success, false);
});
