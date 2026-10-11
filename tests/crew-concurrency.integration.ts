import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { Database } from "../src/db/connection";
import * as base from "../src/db/schema";
import * as crewTables from "../src/db/crew-schema";
import { crewService } from "../src/server/crew-service";
import { communityService } from "../src/server/community-service";
import { safetyService } from "../src/server/safety-service";
import { AppError } from "../src/server/errors";

const url = new URL(process.env.DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "55432" ||
  url.pathname !== "/sliper_dev"
)
  throw new Error("Crew concurrency checks require the isolated local development database.");

function connection(label: string) {
  const tag = "crew-race-" + label + "-" + randomUUID().slice(0, 8);
  const client = postgres(url.toString(), {
    prepare: false,
    max: 1,
    connection: { application_name: tag, statement_timeout: 15000, lock_timeout: 12000 },
  });
  const db = drizzle(client, { schema: { ...base, ...crewTables } }) as unknown as Database;
  return { tag, client, db };
}
type Connection = ReturnType<typeof connection>;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const setup = connection("fixture"),
    clients = [setup],
    users: { id: string; publicId: string }[] = [];
  const crewIds: string[] = [],
    postIds: string[] = [],
    running: Promise<unknown>[] = [];
  const releases: (() => void)[] = [];
  function connect(label: string) {
    const value = connection(label);
    clients.push(value);
    return value;
  }
  function track<T>(promise: Promise<T>) {
    void promise.catch(() => {});
    running.push(promise);
    return promise;
  }
  async function cleanup() {
    for (const release of releases) release();
    await Promise.allSettled(running);
    try {
      if (crewIds.length) {
        await setup.client`delete from sliper.crew_contributions where crew_id=any(${crewIds}::uuid[])`;
        await setup.client`delete from sliper.crews where id=any(${crewIds}::uuid[])`;
      }
      if (postIds.length) {
        await setup.client`delete from sliper.event_results where post_id=any(${postIds}::uuid[])`;
        await setup.client`delete from sliper.event_admissions where post_id=any(${postIds}::uuid[])`;
        await setup.client`delete from sliper.posts where id=any(${postIds}::uuid[])`;
      }
      if (users.length)
        await setup.client`delete from auth.users where id=any(${users.map((u) => u.id)}::uuid[])`;
    } finally {
      await Promise.all(clients.map((item) => item.client.end()));
    }
  }
  try {
    for (let index = 0; index < 4; index++) {
      const id = randomUUID();
      users.push({ id, publicId: "" });
      await setup.client`insert into auth.users(id) values(${id}::uuid)`;
      const [row] =
        await setup.client`insert into sliper.profiles(id,nickname) values(${id}::uuid,${"동시성검사" + index}) returning public_id`;
      users[index]!.publicId = String(row!.public_id);
    }
  } catch {
    await cleanup();
    throw new Error("Could not initialize isolated concurrency fixtures.");
  }
  const owner = users[0]!,
    member = users[1]!,
    applicant = users[2]!,
    other = users[3]!;
  async function crew(capacity = 20) {
    const id = randomUUID();
    crewIds.push(id);
    await setup.client`insert into sliper.crews(id,owner_id,name,description,category_slug,capacity) values(${id}::uuid,${owner.id}::uuid,'동시성 검사 크루','자동 검증을 위한 임시 크루입니다.','party',${capacity})`;
    await setup.client`insert into sliper.crew_members(crew_id,user_id,role) values(${id}::uuid,${owner.id}::uuid,'manager')`;
    return id;
  }
  async function event() {
    const id = randomUUID();
    postIds.push(id);
    await setup.client`insert into sliper.posts(id,author_id,category_slug,kind,title,body_markdown,sample) values(${id}::uuid,${owner.id}::uuid,'party','모집','동시성 검사 행사','자동 검증을 위한 임시 행사입니다.',false)`;
    await setup.client`insert into sliper.event_settings(post_id,capacity,amount_krw,open,starts_at,ends_at) values(${id}::uuid,20,0,true,'2020-01-01T01:00:00Z','2020-01-01T03:00:00Z')`;
    return id;
  }
  async function addMember(id: string, person = member, role = "member") {
    await setup.client`insert into sliper.crew_members(crew_id,user_id,role) values(${id}::uuid,${person.id}::uuid,${role})`;
  }
  async function attendance(postId: string) {
    const id = randomUUID();
    await setup.client`insert into sliper.event_applications(id,post_id,user_id,attendee_name,contact,amount_krw,status,confirmed_at,event_starts_at,refund_consent_at,expires_at)
      values(${id}::uuid,${postId}::uuid,${member.id}::uuid,'참가자','fixture-private-contact',0,'confirmed',now(),'2020-01-01T01:00:00Z',now(),now()+interval '30 minutes')`;
    await setup.client`insert into sliper.event_admissions(application_id,post_id,user_id,checked_by,checked_at) values(${id}::uuid,${postId}::uuid,${member.id}::uuid,${owner.id}::uuid,'2020-01-01T02:00:00Z')`;
    await setup.client`insert into sliper.event_results(application_id,post_id,user_id,presence,recorder_id) values(${id}::uuid,${postId}::uuid,${member.id}::uuid,'attended',${owner.id}::uuid)`;
  }
  async function hold(kind: "profile" | "crew", id: string) {
    const blocker = connect("blocker"),
      held = deferred(),
      released = deferred();
    releases.push(released.resolve);
    const done = track(
      blocker.client.begin(async (tx) => {
        if (kind === "profile")
          await tx`select id from sliper.profiles where id=${id}::uuid for no key update`;
        else await tx`select id from sliper.crews where id=${id}::uuid for update`;
        held.resolve();
        await released.promise;
      }),
    );
    await Promise.race([
      held.promise,
      done.then(() => {
        throw new Error("Lock fixture ended prematurely.");
      }),
    ]);
    return { release: released.resolve, done };
  }
  return {
    setup,
    owner,
    member,
    applicant,
    other,
    connect,
    track,
    crew,
    event,
    addMember,
    attendance,
    hold,
    cleanup,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

// Observe only our uniquely named connections. No application account IDs or SQL text are logged.
// The blocker gives a deterministic schedule: a service must reach the expected lock before the next starts.
async function waitForLock(f: Fixture, operation: Connection, table: string, mode: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] = await f.setup
      .client`select wait_event_type,query from pg_catalog.pg_stat_activity where application_name=${operation.tag} and state='active'`;
    if (
      row?.wait_event_type === "Lock" &&
      String(row.query).includes('"sliper"."' + table + '"') &&
      String(row.query)
        .toLowerCase()
        .includes("for " + mode)
    )
      return;
    await delay(25);
  }
  assert.fail("The service did not wait for the expected " + table + " lock (" + mode + ").");
}
async function checked(work: (f: Fixture) => Promise<void>) {
  const f = await fixture();
  try {
    await work(f);
  } catch (cause) {
    if (cause instanceof assert.AssertionError || cause instanceof AppError) throw cause;
    // Driver errors contain parameters; expose only an error class/SQLSTATE.
    const code =
      typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : "";
    throw new Error(
      "Concurrency verification failed" +
        (/^[A-Z0-9_]+$/.test(code) ? " (" + code + ")" : "") +
        ".",
    );
  } finally {
    try {
      await f.cleanup();
    } catch {
      throw new Error("Could not clean up concurrency fixtures.");
    }
  }
}

test("event linking and the host comment reward share post-before-profile lock order", async () =>
  checked(async (f) => {
    const crewId = await f.crew(),
      postId = await f.event();
    const operator = f.connect("link"),
      commenter = f.connect("host-comment");
    const hold = await f.hold("profile", f.owner.id);
    const linking = f.track(crewService(operator.db).linkEvent(f.owner.id, crewId, { postId }));
    await waitForLock(f, operator, "profiles", "no key update");
    const commenting = f.track(
      communityService(commenter.db).createComment(f.owner.id, {
        postId,
        bodyMarkdown: "동시에 등록하는 진행 안내입니다.",
      }),
    );
    await waitForLock(f, commenter, "posts", "update");
    hold.release();
    const [linked, comment] = await Promise.all([linking, commenting]);
    assert.equal(linked.events.length, 1);
    assert.equal(comment.comment.body, "동시에 등록하는 진행 안내입니다.");
    const [reward] = await f.setup
      .client`select count(*)::int as count from sliper.activity_events where user_id=${f.owner.id}::uuid and reason='comment'`;
    assert.equal(reward!.count, 1);
  }));

test("contribution verification and the participant comment award both commit without deadlock or duplicate credit", async () =>
  checked(async (f) => {
    const crewId = await f.crew(),
      postId = await f.event();
    await f.addMember(crewId);
    await f.attendance(postId);
    await crewService(f.setup.db).linkEvent(f.owner.id, crewId, { postId });
    const operator = f.connect("verify"),
      commenter = f.connect("member-comment");
    const hold = await f.hold("profile", f.member.id);
    const verifying = f.track(
      crewService(operator.db).verifyContribution(f.owner.id, crewId, {
        postId,
        memberPublicId: f.member.publicId,
        role: "진행 스태프",
        note: "현장 진행",
      }),
    );
    await waitForLock(f, operator, "profiles", "no key update");
    const commenting = f.track(
      communityService(commenter.db).createComment(f.member.id, {
        postId,
        bodyMarkdown: "함께 참가한 행사의 후기입니다.",
      }),
    );
    await waitForLock(f, commenter, "posts", "update");
    hold.release();
    const [verified, comment] = await Promise.all([verifying, commenting]);
    assert.equal(verified.contributions.total, 1);
    assert.equal(comment.comment.body, "함께 참가한 행사의 후기입니다.");
    const rewards = await f.setup
      .client`select reason,count(*)::int as count,sum(points)::int as points from sliper.activity_events where user_id=${f.member.id}::uuid group by reason`;
    assert.equal(rewards.find((row) => row.reason === "crew")?.count, 1);
    assert.equal(rewards.find((row) => row.reason === "crew")?.points, 5);
    assert.equal(rewards.find((row) => row.reason === "comment")?.count, 1);
  }));

test("role revocation serializes both private queue readers before returning the revoked role", async () =>
  checked(async (f) => {
    const crewId = await f.crew();
    await f.addMember(crewId, f.member, "manager");
    await crewService(f.setup.db).join(f.applicant.id, crewId, {
      message: "private-concurrency-join-message",
      publicNameConsent: true,
    });
    const writer = f.connect("revoke"),
      detailReader = f.connect("detail"),
      queueReader = f.connect("queue");
    const hold = await f.hold("crew", crewId);
    const revoking = f.track(
      crewService(writer.db).setRole(f.owner.id, crewId, {
        memberPublicId: f.member.publicId,
        role: "member",
      }),
    );
    await waitForLock(f, writer, "crews", "update");
    const detail = f.track(crewService(detailReader.db).detail(f.member.id, crewId));
    const queue = f.track(crewService(queueReader.db).requests(f.member.id, crewId));
    await Promise.all([
      waitForLock(f, detailReader, "crews", "share"),
      waitForLock(f, queueReader, "crews", "share"),
    ]);
    hold.release();
    const result = await detail;
    await revoking;
    assert.equal(result.myRole, "member");
    assert.equal(result.requests, null);
    assert.equal(JSON.stringify(result).includes("private-concurrency-join-message"), false);
    await assert.rejects(queue, (error) => error instanceof AppError && error.code === "FORBIDDEN");
  }));

test("independent managers approving different applicants cannot exceed crew capacity", async () =>
  checked(async (f) => {
    const crewId = await f.crew(3);
    await f.addMember(crewId, f.member, "manager");
    const service = crewService(f.setup.db),
      consent = { message: "함께 진행하고 싶어요.", publicNameConsent: true };
    await service.join(f.applicant.id, crewId, consent);
    await service.join(f.other.id, crewId, consent);
    const queue = await service.requests(f.owner.id, crewId);
    const owner = f.connect("owner-approve"),
      manager = f.connect("manager-approve");
    const outcomes = await Promise.allSettled([
      f.track(
        crewService(owner.db).decide(f.owner.id, crewId, {
          requestId: queue.items[0]!.id,
          approve: true,
        }),
      ),
      f.track(
        crewService(manager.db).decide(f.member.id, crewId, {
          requestId: queue.items[1]!.id,
          approve: true,
        }),
      ),
    ]);
    assert.equal(outcomes.filter((row) => row.status === "fulfilled").length, 1);
    assert.equal(
      outcomes.filter(
        (row) =>
          row.status === "rejected" &&
          row.reason instanceof AppError &&
          row.reason.code === "CONFLICT",
      ).length,
      1,
    );
    const current = await service.detail(f.owner.id, crewId);
    assert.equal(current.memberCount, 3);
    assert.equal(current.requests?.total, 1);
  }));

test("account withdrawal racing with approval leaves no closed member or pending private note", async () =>
  checked(async (f) => {
    const crewId = await f.crew();
    const service = crewService(f.setup.db);
    await service.join(f.applicant.id, crewId, {
      message: "private-withdrawal-note",
      publicNameConsent: true,
    });
    const request = (await service.requests(f.owner.id, crewId)).items[0]!;
    const approver = f.connect("approve-withdraw"),
      withdrawing = f.connect("withdraw");
    const results = await Promise.allSettled([
      f.track(
        crewService(approver.db).decide(f.owner.id, crewId, {
          requestId: request.id,
          approve: true,
        }),
      ),
      f.track(safetyService(withdrawing.db).withdraw(f.applicant.id)),
    ]);
    assert.equal(results[1]!.status, "fulfilled");
    if (results[0]!.status === "rejected")
      assert.ok(
        results[0]!.reason instanceof AppError &&
          ["FORBIDDEN", "CONFLICT"].includes(results[0]!.reason.code),
      );
    const [state] = await f.setup
      .client`select status from sliper.member_safety where user_id=${f.applicant.id}::uuid`;
    assert.equal(state!.status, "closed");
    const [membership] = await f.setup
      .client`select count(*)::int as count from sliper.crew_members where crew_id=${crewId}::uuid and user_id=${f.applicant.id}::uuid`;
    assert.equal(membership!.count, 0);
    const [note] = await f.setup
      .client`select status,message from sliper.crew_join_requests where crew_id=${crewId}::uuid and user_id=${f.applicant.id}::uuid`;
    assert.equal(note!.status, "withdrawn");
    assert.equal(note!.message, "회원 탈퇴");
  }));
