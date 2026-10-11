import assert from "node:assert/strict";
import test from "node:test";
import { activeNavigationSection, SITE_NAVIGATION } from "../src/domain/navigation";

test("all main menus keep their active section on list and detail pages", () => {
  const routes = [
    ["/", "home"],
    ["/stories", "stories"],
    ["/topics", "topics"],
    ["/topics/mystery", "topics"],
    ["/posts/example", "stories"],
    ["/crews", "players"],
    ["/crews/example", "players"],
    ["/crews/new", "players"],
    ["/crews/example/edit", "players"],
    ["/search", "search"],
    ["/lightning", "lightning"],
    ["/map", "map"],
    ["/map/example", "map"],
    ["/archive", "archive"],
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
