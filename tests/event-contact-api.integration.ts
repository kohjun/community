import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { ActionResult } from "../src/domain/contracts";
import type { EventPrivateContactView } from "../src/domain/event-contact";
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
  throw new Error("Private contact HTTP checks require the isolated local development database.");
const account = loadLocalTestAccount({ ...process.env, NODE_ENV: "development" });
if (!account)
  throw new Error("Set up the existing local test account before private contact HTTP checks.");
const participant = `sliper_test_session=${createLocalTestSession(account, new URL(origin).host)}`,
  guest = `sliper_test_session=${createLocalTestGuestSession(account, new URL(origin).host)}`,
  owner = "00000000-0000-4000-8000-000000000001";
if (account.userId === owner) throw new Error("The participant must differ from the fixture host.");

async function api(path: string, method = "GET", body?: unknown, cookie = "", from = origin) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      Origin: from,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60000),
  });
  return {
    status: response.status,
    headers: response.headers,
    text: await response.text(),
  };
}
function data<T>(response: Awaited<ReturnType<typeof api>>): T {
  assert.equal(response.status, 200, "Unexpected private contact API status");
  assert.match(response.headers.get("cache-control") ?? "", /private.*no-store/);
  const envelope = JSON.parse(response.text) as ActionResult<T>;
  assert.ok(envelope.ok, "The private contact API returned an error");
  return envelope.data;
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

test("event private contacts use current participation, owner-only revisions and non-public HTTP projections", async () => {
  const db = postgres(address.href, { prepare: false, max: 1 }),
    postId = randomUUID(),
    title = "담당자연락검사" + randomUUID().slice(0, 8),
    value = "private-contact-" + randomUUID() + "@example.invalid",
    note = "참가자전용안내" + randomUUID(),
    contactPath = `/api/participation/events/${postId}/private-contact`,
    input = { channel: "email", value, note };
  let created = false;
  let beforeProfiles: string | undefined;
  try {
    beforeProfiles = digest(
      await db`select * from sliper.profiles where id in (${owner}::uuid,${account.userId}::uuid) order by id`,
    );
    const profiles = await db`
      select id from sliper.profiles where id in (${owner}::uuid,${account.userId}::uuid)`;
    assert.equal(profiles.length, 2, "Existing local owner and participant profiles are required.");
    await db.begin(async (tx) => {
      await tx`
        insert into sliper.posts(id,author_id,category_slug,kind,title,body_markdown,is_anonymous,sample,contact_info)
        values(${postId}::uuid,${owner}::uuid,'party','모집',${title},'참가자 전용 연락 동선을 검사하는 임시 행사입니다.',true,true,'공개 문의 안내')`;
      await tx`
        insert into sliper.event_settings(post_id,amount_krw,capacity,open,starts_at,ends_at)
        values(${postId}::uuid,0,3,true,now()+interval '6 days',now()+interval '6 days 2 hours')`;
    });
    created = true;
    const initial = data<EventPrivateContactView>(await api(contactPath));
    assert.equal(initial.revision, 0);
    assert.equal(initial.canManage, true);
    assert.equal(initial.contact, null);
    for (const method of ["GET", "HEAD"]) {
      const denied = await api(contactPath, method, undefined, guest);
      assert.equal(denied.status, 401);
      assert.equal(denied.text.includes(value), false);
      if (method === "HEAD") assert.equal(denied.text, "");
    }
    assert.equal((await api(contactPath, "GET", undefined, participant)).status, 403);
    assert.equal(
      (
        await api(
          contactPath,
          "PUT",
          { expectedRevision: 0, ...input },
          "",
          "https://untrusted.example.invalid",
        )
      ).status,
      403,
    );
    const saved = data<EventPrivateContactView>(
      await api(contactPath, "PUT", { expectedRevision: 0, ...input }),
    );
    assert.equal(saved.revision, 1);
    assert.equal(saved.canManage, true);
    assert.deepEqual(saved.contact, input);
    assert.equal((await api(contactPath, "PUT", { expectedRevision: 0, ...input })).status, 409);
    const [pending] = await db`
      insert into sliper.event_applications(post_id,user_id,attendee_name,contact,amount_krw,status,expires_at)
      values(${postId}::uuid,${account.userId}::uuid,'비공개 연락 검사 참가자','participant@example.invalid',0,'pending_payment',now()+interval '30 minutes') returning id`;
    assert.ok(pending);
    assert.equal((await api(contactPath, "GET", undefined, participant)).status, 403);
    await db`
      update sliper.event_applications set status='confirmed',confirmed_at=now() where id=${pending.id}::uuid`;
    const [membership] = await db`
      select revoked_at from sliper.room_members where post_id=${postId}::uuid and user_id=${account.userId}::uuid`;
    assert.ok(membership, "Confirmation must create the matching announcement-room membership.");
    assert.equal(membership.revoked_at, null);
    const visible = data<EventPrivateContactView>(
      await api(contactPath, "GET", undefined, participant),
    );
    assert.equal(visible.canManage, false);
    assert.equal(visible.revision, 1);
    assert.deepEqual(visible.contact, input);
    for (const method of ["PUT", "DELETE"])
      assert.equal(
        (
          await api(
            contactPath,
            method,
            method === "PUT" ? { expectedRevision: 1, ...input } : { expectedRevision: 1 },
            participant,
          )
        ).status,
        403,
      );
    for (const path of [
      `/api/community/posts/${postId}`,
      `/api/community?search=${encodeURIComponent(title)}`,
      `/api/participation/events/${postId}`,
      `/api/search?q=${encodeURIComponent(title)}`,
      `/posts/${postId}`,
    ]) {
      const response = await api(path, "GET", undefined, guest);
      assert.equal(
        response.status,
        200,
        "The public fixture remains readable without private contact.",
      );
      assert.equal(response.text.includes(value), false);
      assert.equal(response.text.includes(note), false);
    }
    const searched = data<{ total: number }>(
      await api(`/api/search?q=${encodeURIComponent(value)}`, "GET", undefined, guest),
    );
    assert.equal(searched.total, 0, "Private contact must not become searchable content.");
    const deleted = data<EventPrivateContactView>(
      await api(contactPath, "DELETE", { expectedRevision: 1 }),
    );
    assert.equal(deleted.revision, 2);
    assert.equal(deleted.contact, null);
    assert.equal(
      data<EventPrivateContactView>(await api(contactPath, "GET", undefined, participant)).contact,
      null,
    );
    assert.equal((await api(contactPath, "PUT", { expectedRevision: 0, ...input })).status, 409);
    const restored = data<EventPrivateContactView>(
      await api(contactPath, "PUT", { expectedRevision: 2, ...input }),
    );
    assert.equal(restored.revision, 3);
    assert.deepEqual(restored.contact, input);
    await db`update sliper.event_applications set status='cancelled' where id=${pending.id}::uuid`;
    assert.equal((await api(contactPath, "GET", undefined, participant)).status, 403);
    const [refundable] = await db`
      insert into sliper.event_applications(post_id,user_id,attendee_name,contact,amount_krw,status,confirmed_at,expires_at)
      values(${postId}::uuid,${account.userId}::uuid,'환불 후 권한 검사 참가자','participant@example.invalid',0,'confirmed',now(),now()+interval '30 minutes') returning id`;
    assert.ok(refundable);
    assert.equal((await api(contactPath, "GET", undefined, participant)).status, 200);
    await db`update sliper.event_applications set status='refunded' where id=${refundable.id}::uuid`;
    assert.equal((await api(contactPath, "GET", undefined, participant)).status, 403);
  } finally {
    try {
      if (created)
        await db.begin(async (tx) => {
          const [fixture] = await tx`
            select id from sliper.posts where id=${postId}::uuid and author_id=${owner}::uuid and title=${title} and sample and is_anonymous for update`;
          assert.ok(fixture, "Only this test's exact anonymous sample event may be removed.");
          await tx`delete from sliper.push_deliveries where post_id=${postId}::uuid`;
          await tx`delete from sliper.activity_events where source_key=${"post:" + postId}`;
          await tx`delete from sliper.event_applications where post_id=${postId}::uuid`;
          await tx`delete from sliper.posts where id=${postId}::uuid`;
        });
      const [leftover] = await db`
        select (select count(*) from sliper.posts where id=${postId}::uuid)::int as posts,
          (select count(*) from sliper.event_applications where post_id=${postId}::uuid)::int as applications,
          (select count(*) from sliper.event_private_contacts where post_id=${postId}::uuid)::int as contacts`;
      assert.deepEqual(leftover, { posts: 0, applications: 0, contacts: 0 });
      if (beforeProfiles !== undefined)
        assert.equal(
          digest(
            await db`select * from sliper.profiles where id in (${owner}::uuid,${account.userId}::uuid) order by id`,
          ),
          beforeProfiles,
          "Existing profile fields and timestamps must remain unchanged.",
        );
    } finally {
      await db.end();
    }
  }
});
