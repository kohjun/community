import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import { eventRecords, eventSettings, posts } from "../src/db/schema";
import { communityVenues } from "../src/db/venue-schema";
import type { ActionResult } from "../src/domain/contracts";
import type { PlaceHistoryPage } from "../src/domain/place-history";
import type { RecordDetail } from "../src/domain/records";
import { eventMapService } from "../src/server/event-map-service";
import { communityService } from "../src/server/community-service";
import { participationService } from "../src/server/participation-service";
import { eventOperationsService } from "../src/server/event-operations-service";
import { recordService } from "../src/server/record-service";
import {
  createLocalTestGuestSession,
  createLocalTestSession,
  loadLocalTestAccount,
} from "../src/server/local-test-auth";

const origin = "http://127.0.0.1:3000",
  address = new URL(process.env.DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  process.env.APP_ORIGIN !== origin ||
  !["postgres:", "postgresql:"].includes(address.protocol) ||
  address.hostname !== "127.0.0.1" ||
  address.port !== "55432" ||
  address.pathname !== "/sliper_dev"
)
  throw new Error(
    "Place-history HTTP checks require the isolated local development database and origin.",
  );
const account = loadLocalTestAccount({ ...process.env, NODE_ENV: "development" });
if (!account)
  throw new Error(
    "The existing signed local test member is required for place-history HTTP checks.",
  );
const actor = account.userId,
  memberCookie = "sliper_test_session=" + createLocalTestSession(account, new URL(origin).host),
  guestCookie = "sliper_test_session=" + createLocalTestGuestSession(account, new URL(origin).host);
type Reply<T> = { status: number; result: ActionResult<T> };
async function api<T>(path: string, cookie = memberCookie): Promise<Reply<T>> {
  const response = await fetch(origin + path, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(60000),
  });
  assert.equal(response.headers.get("cache-control"), "private, no-store", path);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/, path);
  return { status: response.status, result: (await response.json()) as ActionResult<T> };
}
function data<T>(response: Reply<T>): T {
  assert.equal(response.status, 200);
  if (!response.result.ok) throw new Error(response.result.error.message);
  return response.result.data;
}
function error(response: Reply<unknown>, status: number, code: string) {
  assert.equal(response.status, status);
  assert.equal(response.result.ok, false);
  if (!response.result.ok) assert.equal(response.result.error.code, code);
}

test("place-history HTTP enforces membership and no-store, validates queries, exposes safe venue tips and masks deleted sources", async () => {
  const connection = createDatabase(address.toString(), 1),
    db = connection.db,
    places = eventMapService(db),
    records = recordService(db);
  let placeId = "",
    postId = "";
  try {
    const place = await places.create(actor, {
      name: "api-place-history-" + randomUUID().slice(0, 8),
      address: "서울특별시 마포구 장소이력HTTP검사로 10",
      description: "실제 모임 장소가 아닌 HTTP 권한과 응답 경계 검증용 가상 장소입니다.",
      latitude: 37.55,
      longitude: 126.92,
      categorySlug: "party",
      spaceType: "outdoor",
      isFree: true,
      feeNote: "무료 검증용 장소",
      capacity: 20,
      tags: ["검사"],
      websiteUrl: null,
    });
    placeId = place.id;
    postId = (
      await communityService(db).createPost(actor, {
        categorySlug: "party",
        kind: "모집",
        title: "api-place-record-" + randomUUID(),
        bodyMarkdown: "PRIVATE-HTTP-POST 주최자의 상세 준비와 내부 진행 정보가 포함되어 있습니다.",
        location: place.name,
        eventDate: "2020년 1월 1일",
        eventFee: "무료",
        venue: {
          latitude: place.latitude,
          longitude: place.longitude,
          communityVenueId: place.id,
          communityVenueVersion: place.version,
        },
      })
    ).id;
    await participationService(db).configure(actor, postId, {
      amountKRW: 0,
      capacity: 20,
      open: false,
      startsAt: "2020-01-01T01:00:00Z",
      endsAt: "2020-01-01T03:00:00Z",
    });
    await eventOperationsService(db).finalize(actor, postId);
    const initial = await records.detail(actor, postId),
      saved = await records.save(actor, postId, {
        expectedUpdatedAt: initial.updatedAt,
        purpose: "공원에서 함께 소통하는 미션을 기획하고 운영했습니다.",
        execution: "PRIVATE-HTTP-EXECUTION 참가자와 주최자의 내부 진행 계획을 남깁니다.",
        highlights: "공원 입구 안내가 도움이 되었습니다.",
        improvements: "비가 올 때 이용할 지붕 있는 공간을 준비하겠습니다.",
        venueTips: "HTTP-TIP 공원 입구에서 모이고 비가 올 때 쉴 장소를 확인하세요.",
        bodyDocument: {
          version: 1,
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "PRIVATE-HTTP-BODY 전체 회고와 주최자의 진행 계획을 기록합니다.",
                },
              ],
            },
          ],
        },
        relatedPostIds: [],
        libraryIds: [],
      });
    const path = `/api/places/${placeId}/history`;
    error(await api(path, guestCookie), 401, "UNAUTHENTICATED");
    assert.deepEqual(data(await api<PlaceHistoryPage>(path)).items, []);
    await records.publish(actor, postId, { expectedUpdatedAt: saved.updatedAt, published: true });
    const history = data(
      await api<PlaceHistoryPage>(path + "?tab=tips&q=HTTP-TIP&category=party&page=1"),
    );
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0]!.record.postId, postId);
    assert.equal(history.items[0]!.venue.id, placeId);
    assert.match(history.items[0]!.venueTips, /HTTP-TIP/);
    assert.equal(history.stats.completedEvents, 1);
    assert.equal(history.stats.attended, 0);
    assert.equal(history.stats.tips, 1);
    assert.equal(history.total, 1);
    for (const [cookie, allowed] of [
      [memberCookie, true],
      [guestCookie, false],
    ] as const) {
      const page = await fetch(origin + "/places/" + placeId + "?tab=tips", {
        headers: { Cookie: cookie },
        signal: AbortSignal.timeout(60000),
      });
      assert.equal(page.status, 200);
      const html = await page.text();
      assert.equal(html.includes(place.name), allowed);
      assert.equal(html.includes("HTTP-TIP"), allowed);
      assert.equal(html.includes("PRIVATE-HTTP-BODY"), false);
    }
    for (const secret of [
      actor,
      "PRIVATE-HTTP",
      "bodyDocument",
      "bodyMarkdown",
      "phoneNumber",
      "ownerId",
      "uploaderId",
      "attendeeName",
      "contactInfo",
    ])
      assert.equal(JSON.stringify(history).includes(secret), false);
    for (const query of [
      "page=0",
      "page=1.2",
      "page=1001",
      "tab=all",
      "category=invalid",
      "q=" + "x".repeat(101),
      "page=1&page=2",
      "q=first&q=second",
      "mine=1",
      "ownerId=" + actor,
    ])
      error(await api(path + "?" + query), 400, "VALIDATION");
    error(await api("/api/places/invalid/history"), 400, "VALIDATION");
    const head = await fetch(origin + path, {
      method: "HEAD",
      headers: { Cookie: memberCookie },
      signal: AbortSignal.timeout(60000),
    });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("cache-control"), "private, no-store");
    assert.equal(await head.text(), "");
    await places.remove(actor, placeId, { version: 1 });
    error(await api(path), 404, "NOT_FOUND");
    const record = data(await api<RecordDetail>("/api/records/" + postId));
    assert.equal(record.snapshot.venue, null);
    assert.equal(record.location, "장소 정보 비공개");
    assert.equal(record.snapshot.location, "장소 정보 비공개");
    assert.equal(record.venueTips, "");
    const [stored] = await db.select().from(eventRecords).where(eq(eventRecords.postId, postId));
    assert.equal(stored!.snapshot.venue?.id, placeId);
    assert.match(stored!.venueTips, /HTTP-TIP/);
  } finally {
    try {
      if (postId) {
        await db.delete(eventRecords).where(eq(eventRecords.postId, postId));
        await db.delete(eventSettings).where(eq(eventSettings.postId, postId));
        await db.delete(posts).where(eq(posts.id, postId));
      }
      if (placeId) await db.delete(communityVenues).where(eq(communityVenues.id, placeId));
    } finally {
      await connection.close();
    }
  }
});
