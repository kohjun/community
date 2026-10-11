import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ActionResult } from "../src/domain/contracts";
import type { CommunityVenue, EventMapSnapshot, VenueInput } from "../src/domain/event-map";
import { createLocalTestSession, loadLocalTestAccount } from "../src/server/local-test-auth";

const origin = "http://127.0.0.1:3000";
function isolatedDatabase(value: string | undefined): boolean {
  try {
    const address = new URL(value ?? "http://missing");
    return (
      ["postgres:", "postgresql:"].includes(address.protocol) &&
      address.hostname === "127.0.0.1" &&
      address.port === "55432" &&
      address.pathname === "/sliper_dev"
    );
  } catch {
    return false;
  }
}
if (
  (process.env.NODE_ENV !== undefined && process.env.NODE_ENV !== "development") ||
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  process.env.APP_ORIGIN !== origin ||
  !isolatedDatabase(process.env.DATABASE_URL) ||
  !isolatedDatabase(process.env.MIGRATION_DATABASE_URL)
) {
  throw new Error(
    "Event-map HTTP checks require the isolated local development database and origin.",
  );
}
const developmentActor = "00000000-0000-4000-8000-000000000001";
// The CLI has no Next.js NODE_ENV by default; the exact local gate above is required first.
const account = loadLocalTestAccount({ ...process.env, NODE_ENV: "development" });
if (!account || account.userId === developmentActor)
  throw new Error("A separate local test member is required for venue ownership HTTP checks.");
// Reuse the existing isolated test identity without altering its account or secret settings.
const otherCookie = `sliper_test_session=${createLocalTestSession(account, "127.0.0.1:3000")}`;
async function api<T>(path: string, method = "GET", body?: unknown, cookie = "", from = origin) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      Origin: from,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60000),
  });
  let result: ActionResult<T>;
  try {
    result = (await response.json()) as ActionResult<T>;
  } catch {
    throw new Error("Event-map HTTP returned an unexpected non-JSON response.");
  }
  return {
    status: response.status,
    result,
    cookie:
      response.headers
        .getSetCookie()
        .find((value) => value.startsWith("sliper_test_session="))
        ?.split(";")[0] ?? "",
    cacheControl: response.headers.get("cache-control"),
  };
}
function data<T>(response: { status: number; result: ActionResult<T> }): T {
  assert.equal(response.status, 200, "Unexpected event-map HTTP status");
  if (!response.result.ok) throw new Error(response.result.error.message);
  return response.result.data;
}
function errorCode(
  response: { status: number; result: ActionResult<unknown> },
  status: number,
  code: string,
) {
  assert.equal(response.status, status);
  assert.equal(response.result.ok, false);
  if (!response.result.ok) assert.equal(response.result.error.code, code);
}
async function page(path: string) {
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(60000) });
  assert.equal(response.status, 200, "Event-map linked pages must render successfully");
  return response.text();
}
function publicProjection(place: CommunityVenue) {
  const text = JSON.stringify(place);
  for (const privateValue of [
    developmentActor,
    account!.userId,
    "ownerId",
    "phoneNumber",
    "contactInfo",
    "deletedAt",
  ])
    assert.equal(
      text.includes(privateValue),
      false,
      "A public venue projection exposed private account data",
    );
  assert.ok(place.contributor?.publicId);
}

test("event-map HTTP persists collaborative venues, enforces ownership and origin, preserves idempotent recommendations and hides deleted fixtures", async () => {
  const marker = `[개발검증 장소] ${randomUUID().slice(0, 8)}`;
  const input: VenueInput = {
    name: marker,
    address: "서울특별시 마포구 개발검증용 가상 장소 10",
    description:
      "실제 모임 장소가 아닌 API 개발검증용 가상 장소입니다. 검사가 끝나면 이 테스트 장소만 삭제됩니다.",
    latitude: 37.55,
    longitude: 126.92,
    categorySlug: "party",
    spaceType: "outdoor",
    isFree: true,
    feeNote: "실제 비용이 없는 검증 데이터",
    capacity: 8,
    tags: ["개발검증"],
    websiteUrl: null,
  };
  let id: string | null = null;
  let latestVersion = 1;
  let removed = false;
  const logout = await api<{ loggedOut: boolean }>("/api/auth/test/logout", "POST", {});
  assert.deepEqual(data(logout), { loggedOut: true });
  const guestCookie = logout.cookie;
  assert.ok(guestCookie, "Logout must return an isolated signed guest cookie");
  const memberState = data(
    await api<{ authenticated: boolean }>("/api/auth/test/session", "GET", undefined, otherCookie),
  );
  assert.equal(
    memberState.authenticated,
    true,
    "The separate local test identity must be available",
  );
  const guestState = data(
    await api<{ authenticated: boolean }>("/api/auth/test/session", "GET", undefined, guestCookie),
  );
  assert.equal(guestState.authenticated, false);
  try {
    errorCode(
      await api("/api/event-map", "POST", input, "", "https://untrusted.example.invalid"),
      403,
      "FORBIDDEN",
    );
    errorCode(await api("/api/event-map", "POST", input, guestCookie), 401, "UNAUTHENTICATED");
    errorCode(
      await api("/api/event-map", "POST", { ...input, ownerId: randomUUID() }),
      400,
      "VALIDATION",
    );
    errorCode(await api("/api/event-map", "POST", { ...input, latitude: 91 }), 400, "VALIDATION");
    const createdResponse = await api<CommunityVenue>("/api/event-map", "POST", input);
    const created = data(createdResponse);
    id = created.id;
    latestVersion = created.version;
    assert.equal(created.isOwner, true);
    assert.equal(created.version, 1);
    assert.equal(created.latitude, input.latitude);
    assert.equal(created.longitude, input.longitude);
    assert.equal(createdResponse.cacheControl, "private, no-store");
    publicProjection(created);
    await page(`/map?place=${id}&lat=${input.latitude}&lng=${input.longitude}`);
    await page(`/lightning?venue=${id}&open=1`);
    const unavailable = await page(`/lightning?venue=${id}&venue=invalid&open=1`);
    assert.ok(unavailable.includes("선택한 장소가 삭제되었거나 사용할 수 없어요."));
    await page("/map?lat=invalid&lng=999&place=invalid");
    const url = `/api/event-map/${id}`;
    const guest = data(await api<CommunityVenue>(url, "GET", undefined, guestCookie));
    assert.equal(guest.isOwner, false);
    assert.equal(guest.recommended, false);
    publicProjection(guest);
    const q = new URLSearchParams({
      q: marker,
      mode: "place",
      category: "party",
      freeOnly: "true",
      south: "37.5",
      west: "126.9",
      north: "37.6",
      east: "127",
    });
    const map = data(
      await api<EventMapSnapshot>(`/api/event-map?${q}`, "GET", undefined, guestCookie),
    );
    assert.deepEqual(
      map.venues.map((place) => place.id),
      [id],
    );
    assert.equal(map.totalVenues, 1);
    assert.equal(map.totalEvents, 0);
    assert.equal(map.truncated, false);
    publicProjection(map.venues[0]!);
    const outside = new URLSearchParams({
      q: marker,
      south: "35",
      west: "129",
      north: "36",
      east: "130",
    });
    assert.equal(
      data(await api<EventMapSnapshot>(`/api/event-map?${outside}`, "GET", undefined, guestCookie))
        .totalVenues,
      0,
    );
    errorCode(await api("/api/event-map?south=37"), 400, "VALIDATION");
    errorCode(await api("/api/event-map?freeOnly=invalid"), 400, "VALIDATION");
    const update = { ...input, name: `${marker} 수정됨`, version: latestVersion };
    for (const [method, payload, path] of [
      ["PUT", update, url],
      ["DELETE", { version: latestVersion }, url],
      ["POST", { liked: true }, `${url}/recommend`],
    ] as const) {
      errorCode(await api(path, method, payload, guestCookie), 401, "UNAUTHENTICATED");
      errorCode(
        await api(path, method, payload, "", "https://untrusted.example.invalid"),
        403,
        "FORBIDDEN",
      );
    }
    errorCode(await api(url, "PUT", update, otherCookie), 403, "FORBIDDEN");
    errorCode(await api(url, "DELETE", { version: latestVersion }, otherCookie), 403, "FORBIDDEN");
    const updated = data(await api<CommunityVenue>(url, "PUT", update));
    latestVersion = updated.version;
    assert.equal(latestVersion, 2);
    assert.equal(updated.name, update.name);
    publicProjection(updated);
    errorCode(await api(url, "PUT", update), 409, "CONFLICT");
    errorCode(await api(url, "DELETE", { version: 1 }), 409, "CONFLICT");
    for (let i = 0; i < 2; i++) {
      const recommended = data(
        await api<CommunityVenue>(`${url}/recommend`, "POST", { liked: true }, otherCookie),
      );
      assert.equal(recommended.recommendations, 1);
      assert.equal(recommended.recommended, true);
      assert.equal(recommended.isOwner, false);
      assert.equal(recommended.version, latestVersion);
    }
    const publicRecommended = data(await api<CommunityVenue>(url, "GET", undefined, guestCookie));
    assert.equal(publicRecommended.recommendations, 1);
    assert.equal(publicRecommended.recommended, false);
    assert.equal(data(await api<CommunityVenue>(url)).recommended, false);
    for (let i = 0; i < 2; i++) {
      const unliked = data(
        await api<CommunityVenue>(`${url}/recommend`, "POST", { liked: false }, otherCookie),
      );
      assert.equal(unliked.recommendations, 0);
      assert.equal(unliked.recommended, false);
    }
    assert.deepEqual(data(await api<{ id: string }>(url, "DELETE", { version: latestVersion })), {
      id,
    });
    removed = true;
    const deletedPage = await page(`/lightning?venue=${id}&open=1`);
    assert.ok(deletedPage.includes("선택한 장소가 삭제되었거나 사용할 수 없어요."));
    errorCode(await api(url, "GET", undefined, guestCookie), 404, "NOT_FOUND");
    errorCode(
      await api(`${url}/recommend`, "POST", { liked: true }, otherCookie),
      404,
      "NOT_FOUND",
    );
    assert.equal(
      data(
        await api<EventMapSnapshot>(
          `/api/event-map?q=${encodeURIComponent(marker)}`,
          "GET",
          undefined,
          guestCookie,
        ),
      ).totalVenues,
      0,
    );
  } finally {
    if (id && !removed) {
      const remaining = await api<CommunityVenue>(`/api/event-map/${id}`);
      if (remaining.status !== 404) {
        const own = data(remaining);
        assert.equal(own.isOwner, true, "Only this suite's own fixture may be cleaned up");
        assert.ok(
          own.name.startsWith(marker),
          "Fixture cleanup must retain its exact unique marker",
        );
        data(await api<{ id: string }>(`/api/event-map/${id}`, "DELETE", { version: own.version }));
      }
    }
  }
});
