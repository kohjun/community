import assert from "node:assert/strict";
import test from "node:test";
import {
  activeNavigationSection,
  AUDIENCE_NAVIGATION,
  SITE_NAVIGATION,
} from "../src/domain/navigation";

test("all main menus keep their active section on list and detail pages", () => {
  const routes = [
    ["/", "home"],
    ["/stories", "stories"],
    ["/posts/example", "stories"],
    ["/crews", "players"],
    ["/crews/example", "players"],
    ["/crews/new", "players"],
    ["/crews/example/edit", "players"],
    ["/lightning", "lightning"],
    ["/map", "map"],
    ["/games", "games"],
    ["/games/example", "games"],
    ["/map/example", "map"],
    ["/archive", "archive"],
    ["/records", "archive"],
    ["/records/example", "archive"],
    ["/records/example/edit", "archive"],
    ["/archive/new", "archive"],
    ["/archive/example/edit", "archive"],
    ["/archive/example/host", "archive"],
    ["/archive/events/example", "archive"],
    ["/templates/new", "archive"],
    ["/templates/example/edit", "archive"],
    ["/templates", "archive"],
    ["/templates/example/host", "archive"],
    ["/templates/events/example", "archive"],
    ["/players", "players"],
    ["/players/example", "players"],
    ["/players/review/example", "players"],
    ["/management", "management"],
    ["/management/events/example", "management"],
  ] as const;
  for (const [path, section] of routes) {
    assert.equal(activeNavigationSection(path), section, path);
    assert.equal(activeNavigationSection(path + (path === "/" ? "" : "/")), section);
  }
});

test("partial route prefixes and unrelated activity pages do not select the wrong menu", () => {
  for (const path of [
    null,
    "",
    "/archive-other",
    "/templates-archive",
    "/playersettings",
    "/crews-other",
    "/managements",
    "/maps-other",
    "/mypage",
    "/participation",
    "/search",
    "/topics",
    "/topics/mystery",
    "/rooms/example",
    "/login",
  ]) {
    assert.equal(activeNavigationSection(path), null, String(path));
  }
});

test("local community views can select stories without overriding other page routes", () => {
  assert.equal(activeNavigationSection("/", "stories"), "stories");
  assert.equal(activeNavigationSection("/stories", "home"), "home");
  assert.equal(activeNavigationSection("/archive", "home"), "archive");
  assert.equal(activeNavigationSection("/players/example", "stories"), "players");
});

test("rulebooks and templates share one archive navigation destination", () => {
  const archives = SITE_NAVIGATION.filter((item) => item.href === "/archive");
  assert.equal(archives.length, 1);
  assert.equal(archives[0]?.label, "아카이브");
  assert.ok(SITE_NAVIGATION.every((item) => !item.href.startsWith("/templates")));
});

test("individual players and teams share one people navigation destination", () => {
  const people = SITE_NAVIGATION.filter((item) => item.href === "/players");
  assert.equal(people.length, 1);
  assert.equal(people[0]?.label, "플레이어·크루");
  assert.ok(SITE_NAVIGATION.every((item) => !item.href.startsWith("/crews")));
  assert.equal(activeNavigationSection("/crews/example", "stories"), "players");
});

test("personal tools and discovery destinations are consolidated outside the primary menu", () => {
  assert.deepEqual(
    SITE_NAVIGATION.map((item) => item.id),
    ["home", "stories", "lightning", "map", "archive", "games", "players"],
  );
});

test("event recruitment marks its own header destination without selecting lightning", () => {
  assert.equal(activeNavigationSection("/", "events"), "events");
  assert.equal(activeNavigationSection("/lightning", "events"), "lightning");
  assert.equal(activeNavigationSection("/archive", "events"), "archive");
});

test("participant header separates scheduled events from lightning and keeps discovery in more", () => {
  const { primary, more } = AUDIENCE_NAVIGATION.participant;
  assert.deepEqual(
    primary.map((item) => item.label),
    ["이야기", "이벤트·행사", "번개·모임", "웹게임"],
  );
  const eventUrl = new URL(primary[1].href, "https://sliper.kr");
  assert.equal(eventUrl.searchParams.get("kind"), "모집");
  assert.equal(eventUrl.searchParams.get("meetupType"), "event");
  assert.equal(primary[2].href, "/lightning");
  assert.deepEqual(
    more.map((item) => item.label),
    ["플레이어", "이벤트 맵", "모임 제안하기", "아카이브"],
  );
  assert.equal(more[0].href, "/players");
});

test("host header starts with hosted meetups and moves stories into more", () => {
  const { primary, more } = AUDIENCE_NAVIGATION.host;
  assert.deepEqual(
    primary.map((item) => item.label),
    ["모임 관리", "아카이브", "크루", "웹게임"],
  );
  assert.equal(primary[0].href, "/mypage?tab=events&view=hosting");
  assert.equal(primary[2].href, "/players?tab=crews");
  assert.deepEqual(
    more.map((item) => item.label),
    ["호스트 가이드", "이야기"],
  );
  assert.equal(more[1].href, "/stories");
  assert.equal(activeNavigationSection("/mypage", "management"), "management");
  assert.equal(activeNavigationSection("/mypage"), null);
  assert.equal(activeNavigationSection("/stories", "management"), "stories");
});
