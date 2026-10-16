import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Apply the real previous migration chain, seed legacy records, then apply the new migration.
// No source migration or external database is modified.
test("recipient migration preserves historical crew rights and detaches unverified links without trusting the new owner", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(
      "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
    );
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    const upgrade = journal.entries.find(
      (entry) => entry.tag === "0065_account_responsibility_and_appeal_recipient",
    )!;
    assert.ok(upgrade);
    const apply = async (tag: string) => {
      const statements = (await readFile("drizzle/" + tag + ".sql", "utf8")).split(
        "--> statement-breakpoint",
      );
      await pg.transaction(async (tx) => {
        for (const sql of statements) if (sql.trim()) await tx.exec(sql);
      });
    };
    for (const entry of journal.entries.filter((entry) => entry.idx < upgrade.idx))
      await apply(entry.tag);
    await pg.query("insert into sliper.categories(slug,name,sort_order) values('party','파티',0)");
    const owner = randomUUID(),
      nextOwner = randomUUID(),
      staff = randomUUID();
    for (const [index, id] of [owner, nextOwner, staff].entries()) {
      await pg.query("insert into auth.users values($1)", [id]);
      await pg.query("insert into sliper.profiles(id,nickname) values($1,$2)", [
        id,
        "검증 회원 " + index,
      ]);
    }
    const crew = randomUUID(),
      unknownCrew = randomUUID();
    for (const id of [crew, unknownCrew])
      await pg.query(
        "insert into sliper.crews(id,owner_id,name,description,category_slug) values($1,$2,'과거 크루','과거 대상 회원을 현재 리더로 추정하지 않는 검증 크루입니다.','party')",
        [id, owner],
      );
    await pg.query(
      "insert into sliper.crew_activity(crew_id,actor_id,kind,created_at) values($1,$2,'created','2026-10-01T00:00:00Z')",
      [crew, owner],
    );
    const knownAction = randomUUID(),
      unknownAction = randomUUID();
    for (const [id, target] of [
      [knownAction, crew],
      [unknownAction, unknownCrew],
    ])
      await pg.query(
        "insert into sliper.moderation_audit(id,actor_id,action,target_type,target_id,reason,created_at) values($1,$2,'warn','crew',$3,'과거 경고','2026-10-02T00:00:00Z')",
        [id, staff, target],
      );
    const originalTicket = randomUUID();
    await pg.query(
      "insert into sliper.support_tickets(id,user_id,original_action_id,category,subject,body) values($1,$2,$3,'account','원대상 이의신청','보존할 원래 회원의 이의신청입니다.')",
      [originalTicket, owner, knownAction],
    );
    for (const id of [crew, unknownCrew])
      await pg.query("update sliper.crews set owner_id=$2 where id=$1", [id, nextOwner]);
    await pg.query(
      "insert into sliper.crew_activity(crew_id,actor_id,kind,created_at) values($1,$2,'ownership_transferred','2026-10-03T00:00:00Z')",
      [crew, owner],
    );
    const wrongTicket = randomUUID(),
      unverifiedTicket = randomUUID();
    for (const [id, action] of [
      [wrongTicket, knownAction],
      [unverifiedTicket, unknownAction],
    ])
      await pg.query(
        "insert into sliper.support_tickets(id,user_id,original_action_id,category,subject,body) values($1,$2,$3,'account','이전 연결 문의','회원이 작성한 문의 내용은 보존해야 합니다.')",
        [id, nextOwner, action],
      );
    const legacyHost = randomUUID(),
      legacyEvent = randomUUID();
    await pg.query("insert into auth.users values($1)", [legacyHost]);
    await pg.query("insert into sliper.profiles(id,nickname) values($1,'기존 탈퇴 주최자')", [
      legacyHost,
    ]);
    await pg.query(
      "insert into sliper.posts(id,author_id,category_slug,kind,title,body_markdown) values($1,$2,'party','모집','과거 탈퇴 계정 행사','이전 결함으로 남은 행사의 무관한 갱신을 허용합니다.')",
      [legacyEvent, legacyHost],
    );
    await pg.query(
      "insert into sliper.event_settings(post_id,amount_krw,capacity,open,starts_at,ends_at) values($1,0,5,false,now()+interval '1 day',now()+interval '2 days')",
      [legacyEvent],
    );
    await pg.query("insert into sliper.member_safety(user_id,status) values($1,'closed')", [
      legacyHost,
    ]);
    await apply(upgrade.tag);
    await pg.query(
      "update sliper.posts set title='운영자가 수정한 행사 제목',updated_at=clock_timestamp() where id=$1",
      [legacyEvent],
    );
    await pg.query(
      "update sliper.event_settings set updated_at=clock_timestamp(),questions='[]'::jsonb where post_id=$1",
      [legacyEvent],
    );
    const recipients = await pg.query<{ id: string; affected_user_id: string | null }>(
      "select id,affected_user_id from sliper.moderation_audit",
    );
    assert.equal(recipients.rows.find((row) => row.id === knownAction)!.affected_user_id, owner);
    assert.equal(recipients.rows.find((row) => row.id === unknownAction)!.affected_user_id, null);
    const tickets = await pg.query<{ id: string; original_action_id: string | null; body: string }>(
      "select id,original_action_id,body from sliper.support_tickets",
    );
    assert.equal(
      tickets.rows.find((row) => row.id === originalTicket)!.original_action_id,
      knownAction,
    );
    for (const id of [wrongTicket, unverifiedTicket]) {
      const ticket = tickets.rows.find((row) => row.id === id)!;
      assert.equal(ticket.original_action_id, null);
      assert.equal(ticket.body, "회원이 작성한 문의 내용은 보존해야 합니다.");
    }
    const access = await pg.query<{ original: boolean; transferred: boolean; unverified: boolean }>(
      "select sliper.appeal_action_belongs_to($1,$2) as original,sliper.appeal_action_belongs_to($1,$3) as transferred,sliper.appeal_action_belongs_to($4,$3) as unverified",
      [knownAction, owner, nextOwner, unknownAction],
    );
    assert.deepEqual(access.rows[0], { original: true, transferred: false, unverified: false });
  } finally {
    await pg.close();
  }
});
