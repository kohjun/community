import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyLibraryFilters,
  libraryCursorFromParams,
  libraryFilterParams,
  libraryFiltersFromParams,
  libraryFilterUrl,
} from "../src/components/library-discovery-query";
import { librarySearchParams } from "../src/domain/library";

test("shared archive URLs restore all conditions including zero staff and member-only cases", () => {
  const filters = {
    ...emptyLibraryFilters("template"),
    category: "race",
    search: "코엑스 점령전",
    mine: true,
    players: "20",
    maxDurationMinutes: "240",
    price: "paid" as const,
    used: true,
    difficulty: "standard" as const,
    environment: "mixed" as const,
    maxStaff: "0",
  };
  const params = libraryFilterParams(filters, "nextPage");
  assert.deepEqual(libraryFiltersFromParams(params), filters);
  assert.equal(libraryCursorFromParams(params), "nextPage");
  assert.deepEqual(librarySearchParams(params), {
    kind: "template",
    category: "race",
    search: "코엑스 점령전",
    mine: true,
    players: 20,
    maxDurationMinutes: 240,
    price: "paid",
    used: true,
    difficulty: "standard",
    environment: "mixed",
    maxStaff: 0,
    cursor: "nextPage",
  });
});

test("changing archive conditions clears the old cursor and stale fields while preserving the route hash", () => {
  const url = new URL(
    "https://sliper.example/archive?kind=template&category=race&mine=true&players=20&cursor=previous#materials",
  );
  const next = libraryFilterUrl(url, { ...emptyLibraryFilters("rulebook"), price: "free" });
  assert.equal(next, "/archive?kind=rulebook&price=free#materials");
  assert.equal(url.searchParams.get("cursor"), "previous");
});

test("loading another archive page keeps active conditions and replaces only its cursor", () => {
  const filters = { ...emptyLibraryFilters("template"), players: "12", used: true };
  const next = libraryFilterUrl(
    new URL("https://sliper.example/archive?cursor=old"),
    filters,
    "newPage",
  );
  const params = new URL(next, "https://sliper.example").searchParams;
  assert.deepEqual(libraryFiltersFromParams(params), filters);
  assert.equal(libraryCursorFromParams(params), "newPage");
});

test("explicit false values and blank numeric conditions restore the ordinary archive feed", () => {
  const query = libraryFiltersFromParams(
    new URLSearchParams("mine=false&used=false&players=&maxStaff="),
  );
  assert.deepEqual(query, emptyLibraryFilters());
  assert.deepEqual(librarySearchParams(libraryFilterParams(query)), { search: "", mine: false });
});

test("invalid URL control values cannot become NaN, out-of-range filters, or a long cursor", () => {
  const params = new URLSearchParams({
    players: "-1",
    maxDurationMinutes: "1.5",
    maxStaff: "101",
    difficulty: "secret",
    environment: "invalid",
    cursor: "x".repeat(1025),
  });
  assert.deepEqual(libraryFiltersFromParams(params), emptyLibraryFilters());
  assert.equal(libraryCursorFromParams(params), undefined);
  assert.throws(() => librarySearchParams(params));
});

test("strict URL search rejects prototype-shaped and repeated unknown fields", () => {
  for (const query of ["__proto__=x", "__proto__=x&__proto__=y", "constructor=x"])
    assert.throws(() => librarySearchParams(new URLSearchParams(query)));
});
