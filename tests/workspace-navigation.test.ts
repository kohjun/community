import assert from "node:assert/strict";
import test from "node:test";
import {
  myPageSection,
  archiveRecordsHref,
  WORKSPACE_REDIRECTS,
} from "../src/domain/workspace-navigation";
test("My Page URLs distinguish profile, participation and hosted events", () => {
  assert.equal(myPageSection({}), "profile");
  assert.equal(myPageSection({ tab: "events" }), "participating");
  assert.equal(myPageSection({ tab: "events", view: "hosting" }), "hosting");
  assert.equal(myPageSection({ tab: "events", view: "unknown" }), "participating");
  assert.equal(myPageSection({ tab: ["events", "other"] }), "profile");
});
test("record archive links preserve a selected source material without injecting more parameters", () => {
  const link = new URL(archiveRecordsHref("material&mine=1"), "https://sliper.kr");
  assert.equal(link.pathname, "/archive");
  assert.equal(link.searchParams.get("tab"), "records");
  assert.equal(link.searchParams.get("libraryId"), "material&mine=1");
  assert.equal(link.searchParams.has("mine"), false);
  assert.equal(archiveRecordsHref(), "/archive?tab=records");
});
test("retired list entries redirect internally without catching detail routes", () => {
  for (const rule of WORKSPACE_REDIRECTS) {
    assert.ok(rule.destination.startsWith("/") && !rule.destination.startsWith("//"));
    assert.equal(rule.source.includes(":"), false);
  }
  assert.equal(
    WORKSPACE_REDIRECTS.find((rule) => rule.source === "/records")?.destination,
    "/archive?tab=records",
  );
  assert.equal(
    WORKSPACE_REDIRECTS.find((rule) => rule.source === "/management")?.destination,
    "/mypage?tab=events&view=hosting",
  );
});
