import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advertisingAllowedPath,
  advertisingAllowedLocation,
  isAdvertisingOrigin,
  produceAdsTxt,
  readAdvertisingConfiguration,
} from "../src/domain/advertising";

// Fictional identifiers are parsed locally only. These tests never load Google's script.
const complete = {
  NODE_ENV: "production",
  LOCAL_DATABASE: "0",
  APP_ORIGIN: "https://sliper-community.co.kr",
  SLIPER_ADSENSE_ENABLED: "true",
  SLIPER_ADSENSE_CLIENT_ID: "ca-pub-1000000000000011",
  SLIPER_ADSENSE_SLOT_INLINE: "71",
  SLIPER_ADSENSE_SLOT_LEFT: "72",
  SLIPER_ADSENSE_SLOT_RIGHT: "73",
};
const disabled = {
  enabled: false,
  clientId: null,
  slots: { inline: null, left: null, right: null },
  siteOrigin: null,
};

const verification = {
  ...disabled,
  clientId: complete.SLIPER_ADSENSE_CLIENT_ID,
  siteOrigin: complete.APP_ORIGIN,
};

test("live AdSense requires explicit production activation and is disabled for local DB", () => {
  assert.deepEqual(readAdvertisingConfiguration({}), disabled);
  for (const NODE_ENV of [undefined, "development", "test"]) {
    assert.deepEqual(readAdvertisingConfiguration({ ...complete, NODE_ENV }), disabled);
  }
  for (const SLIPER_ADSENSE_ENABLED of [undefined, "false", "TRUE", "1", " true"]) {
    assert.deepEqual(
      readAdvertisingConfiguration({ ...complete, SLIPER_ADSENSE_ENABLED }),
      verification,
    );
  }
  assert.deepEqual(readAdvertisingConfiguration({ ...complete, LOCAL_DATABASE: "1" }), disabled);
  assert.equal(readAdvertisingConfiguration(complete).enabled, true);
});

test("public HTTPS site origin excludes development and malformed hosts", () => {
  for (const APP_ORIGIN of [
    undefined,
    "",
    "http://sliper-community.co.kr",
    "https://localhost",
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://192.168.0.1",
    "https://[::1]",
    "https://[2606:4700:4700::1111]",
    "https://sliper.local",
    "https://app.internal",
    "https://sliper.lan",
    "https://sliper.test",
    "https://sliper.invalid",
    "https://example.com",
    "https://sub.example.org",
    "https://sliper.example",
    "https://sliper-community.co.kr:3000",
    "https://user@sliper-community.co.kr",
    "https://sliper-community.co.kr/path",
    "https://sliper-community.co.kr?preview=1",
    "https://sliper-community.co.kr#hash",
    "https://sliper-community.co.kr.",
    " https://sliper-community.co.kr",
    "https://sliper-community.co.kr\\anything",
    "https://-sliper.co.kr",
    "https://sliper-.co.kr",
    "https://sliper.co-",
  ]) {
    assert.deepEqual(
      readAdvertisingConfiguration({ ...complete, APP_ORIGIN }),
      disabled,
      APP_ORIGIN ?? "missing domain",
    );
  }
  assert.equal(
    readAdvertisingConfiguration({ ...complete, APP_ORIGIN: "https://SLIPER-COMMUNITY.co.kr/" })
      .siteOrigin,
    "https://sliper-community.co.kr",
  );
});

test("missing or malformed publisher and unit IDs fail closed without placeholders", () => {
  for (const SLIPER_ADSENSE_CLIENT_ID of [
    undefined,
    "",
    "pub-1000000000000011",
    "ca-pub-0000000000000000",
    "ca-pub-123",
    "ca-pub-10000000000000111",
    "ca-pub-1000000000000011\n",
    "ca-pub-1000000000000011<script>",
  ]) {
    assert.deepEqual(
      readAdvertisingConfiguration({ ...complete, SLIPER_ADSENSE_CLIENT_ID }),
      disabled,
    );
  }
  for (const invalid of ["", "-1", "1.2", "<script>", "71\n", " 71", "123456789012345678901"]) {
    assert.deepEqual(
      readAdvertisingConfiguration({ ...complete, SLIPER_ADSENSE_SLOT_INLINE: invalid }),
      verification,
    );
  }
  for (const field of ["SLIPER_ADSENSE_SLOT_LEFT", "SLIPER_ADSENSE_SLOT_RIGHT"] as const) {
    assert.deepEqual(
      readAdvertisingConfiguration({ ...complete, [field]: "broken" }),
      verification,
    );
  }
});

test("optional rails may be unconfigured and the DTO contains no unrelated environment values", () => {
  const configuration = readAdvertisingConfiguration({
    ...complete,
    SLIPER_ADSENSE_SLOT_LEFT: "",
    SLIPER_ADSENSE_SLOT_RIGHT: undefined,
    DATABASE_URL: "unrelated-private-value",
  });
  assert.deepEqual(configuration, {
    enabled: true,
    clientId: complete.SLIPER_ADSENSE_CLIENT_ID,
    slots: { inline: "71", left: null, right: null },
    siteOrigin: complete.APP_ORIGIN,
  });
  assert.equal(JSON.stringify(configuration).includes("unrelated-private-value"), false);
});

test("ad placements use a strict public-list allowlist and exclude personal and editing screens", () => {
  for (const path of [
    "/",
    "/stories",
    "/lightning",
    "/archive",
    "/topics",
    "/topics/mystery",
    "/topics/mission-race",
    "/topics/social-party",
  ]) {
    assert.equal(advertisingAllowedPath(path), true, path);
  }
  for (const path of [
    "",
    "//stories",
    "/stories/",
    "/stories?kind=mine",
    "/stories/new",
    "/stories/private-post",
    "/lightning/new",
    "/archive/new",
    "/archive/123",
    "/archive/purchases",
    "/templates",
    "/topics/unknown",
    "/topics/mystery/edit",
    "/topics/MYSTERY",
    "/topics/%6dystery",
    "/players",
    "/players/123",
    "/crews",
    "/records",
    "/records/123",
    "/events/123",
    "/rooms",
    "/rooms/123",
    "/participation/123",
    "/management",
    "/notifications",
    "/login",
    "/signup",
    "/mypage",
    "/settings/appeals",
    "/admin/operations",
    "/search",
    "/api/records",
  ])
    assert.equal(advertisingAllowedPath(path), false, path);
});

test("production browser and ads.txt requests must match the configured domain exactly", () => {
  const { siteOrigin } = readAdvertisingConfiguration(complete);
  assert.equal(isAdvertisingOrigin(complete.APP_ORIGIN, siteOrigin), true);
  assert.equal(isAdvertisingOrigin(complete.APP_ORIGIN + "/", siteOrigin), true);
  for (const origin of [
    "http://127.0.0.1:3000",
    "https://localhost",
    "https://preview.sliper-community.co.kr",
    "https://sliper-community.co.kr:3000",
    "http://sliper-community.co.kr",
    "https://attacker.net",
    complete.APP_ORIGIN + "/stories",
    "not a URL",
  ]) {
    assert.equal(isAdvertisingOrigin(origin, siteOrigin), false, origin);
  }
  assert.equal(isAdvertisingOrigin(complete.APP_ORIGIN, null), false);
});

test("ads.txt emits only a validated current publisher in Google's plain-text format", () => {
  const configuration = readAdvertisingConfiguration(complete);
  assert.equal(
    produceAdsTxt(configuration),
    "google.com, pub-1000000000000011, DIRECT, f08c47fec0942fa0\n",
  );
  assert.equal(produceAdsTxt(disabled), null);
  assert.equal(produceAdsTxt({ ...configuration, enabled: false }), produceAdsTxt(configuration));
  assert.equal(
    produceAdsTxt({ ...configuration, clientId: "ca-pub-1000000000000011\nother.com" }),
    null,
  );
  assert.equal(produceAdsTxt({ ...configuration, siteOrigin: "http://localhost" }), null);
  assert.equal(
    produceAdsTxt({ ...configuration, slots: { ...configuration.slots, inline: null } }),
    produceAdsTxt(configuration),
  );
});

test("verification is available before site approval without requesting live ads", () => {
  const configuration = readAdvertisingConfiguration({
    ...complete,
    SLIPER_ADSENSE_ENABLED: "false",
    SLIPER_ADSENSE_SLOT_INLINE: undefined,
    SLIPER_ADSENSE_SLOT_LEFT: undefined,
    SLIPER_ADSENSE_SLOT_RIGHT: undefined,
  });
  assert.deepEqual(configuration, verification);
  assert.equal(
    produceAdsTxt(configuration),
    "google.com, pub-1000000000000011, DIRECT, f08c47fec0942fa0\n",
  );
});

test("personal, creation, duplicate and unknown URL filters exclude live ads on public paths", () => {
  for (const [path, query] of [
    ["/archive", "mine=true"],
    ["/archive", "mine=false"],
    ["/archive", "mine="],
    ["/archive", "used=true"],
    ["/archive", "used=false"],
    ["/archive", "used="],
    ["/stories", "view=mine"],
    ["/stories", "view=bookmarks"],
    ["/stories", "view=home&view=mine"],
    ["/stories", "composeTopic=mystery"],
    ["/stories", "postId=123"],
    ["/", "post=123"],
    ["/", "edit=0"],
    ["/lightning", "open=0"],
    ["/lightning", "venue=123"],
    ["/topics/mystery", "focus=interests"],
    ["/stories", "focus=interests"],
    ["/archive", "futurePrivateMode=1"],
    ["/stories", "page=1&page=2"],
    ["/records", ""],
  ])
    assert.equal(advertisingAllowedLocation(path!, query!), false, path + "?" + query);
  for (const [path, query] of [
    ["/", ""],
    ["/stories", "category=race&kind=모집&view=popular&page=2"],
    ["/stories", "discussionType=question&focus=unanswered"],
    ["/archive", "kind=template&players=20&price=free&environment=indoor&maxStaff=3"],
    ["/lightning", "activityCategory=board-games&tag=추리&search=주말"],
    ["/topics/mystery", "storiesPage=2&recruitmentPage=1&libraryPage=3&focus=all"],
  ]) {
    assert.equal(advertisingAllowedLocation(path!, query!), true, path + "?" + query);
    assert.equal(advertisingAllowedLocation(path!, new URLSearchParams(query!)), true);
  }
});
