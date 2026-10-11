import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import {
  applicationQuestionsSchema,
  snapshotApplicationAnswers,
  type ApplicationQuestion,
} from "../src/domain/application-questions";
import { applicationSchema } from "../src/domain/participation";
import { participationService } from "../src/server/participation-service";
import { communityService } from "../src/server/community-service";
import { AppError } from "../src/server/errors";

const pg = new PGlite();
const db = drizzle(pg, { schema });
const service = participationService(db as unknown as Database);
const community = communityService(db as unknown as Database);
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
const phone = "01012345678";
let owner: string, attendee: string, outsider: string, postId: string;
let questions: ApplicationQuestion[];
const base = { note: "처음 참가해요", consent: true };
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(schema.profiles).values({
    id,
    nickname,
    phoneNumber: phone,
    profileCompletedAt: new Date(),
    onboardingConsentAt: new Date(),
  });
  return id;
}
async function config(external = false, approvalMode: "manual" | "automatic" = "manual") {
  if (external)
    await db
      .update(schema.posts)
      .set({ applicationUrl: "https://example.com/event" })
      .where(eq(schema.posts.id, postId));
  return service.configure(owner, postId, {
    amountKRW: 0,
    capacity: 3,
    open: true,
    approvalMode,
    questions,
  });
}
async function form() {
  const event = await service.overview(attendee, postId);
  return {
    ...base,
    questionnaireVersion: event.config!.questionnaireVersion,
    answers: [{ questionId: questions[0]!.id, value: "두뇌형" }],
  };
}
async function paidFirst() {
  const [profile] = await db
    .select({ publicId: schema.profiles.publicId })
    .from(schema.profiles)
    .where(eq(schema.profiles.id, attendee));
  return service.externalPayment("bridge", {
    eventId: randomUUID(),
    postId,
    publicProfileId: profile!.publicId,
    externalReference: "order-first",
    attendeeName: "외부 닉네임",
    contact: "01099998888",
    amountKRW: 0,
    currency: "KRW",
    status: "paid",
  });
}
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;");
  owner = await member("등록자");
  attendee = await member("내 닉네임");
  outsider = await member("다른 참가자");
  postId = (
    await community.createPost(owner, {
      categorySlug: "party",
      kind: "모집",
      title: "질문이 있는 행사",
      bodyMarkdown: "참가자를 모집합니다.",
      location: "서울",
      eventDate: "토요일",
      eventFee: "무료",
      isAnonymous: false,
      imageAssetIds: [],
    })
  ).id;
  questions = [
    {
      id: randomUUID(),
      prompt: "어떤 역할을 맡고 싶나요?",
      type: "single_choice",
      required: true,
      options: ["두뇌형", "피지컬형"],
    },
    {
      id: randomUUID(),
      prompt: "추가로 알려주실 내용이 있나요?",
      type: "text",
      required: false,
      options: [],
    },
  ];
});
after(() => pg.close());

test("application form never accepts a forged member nickname, phone, or identity", () => {
  assert.deepEqual(applicationSchema.parse(base).answers, []);
  for (const forged of [
    { attendeeName: "다른 이름" },
    { contact: "01099998888" },
    { userId: randomUUID() },
    { amountKRW: 1 },
  ])
    assert.throws(() => applicationSchema.parse({ ...base, ...forged }));
});

test("question setup enforces IDs, question types, distinct options and field limits", () => {
  assert.equal(applicationQuestionsSchema.parse(questions).length, 2);
  for (const input of [
    [questions[0], questions[0]],
    [questions[0], { ...questions[0], id: questions[0]!.id.toUpperCase() }],
    [{ ...questions[0], options: ["한 개"] }],
    [{ ...questions[0], options: ["같은 선택지", " 같은 선택지 "] }],
    [{ ...questions[1], options: ["주관식에 선택지"] }],
    [{ ...questions[0], prompt: "가".repeat(161) }],
    [{ ...questions[0], options: ["가".repeat(81), "나"] }],
    Array.from({ length: 11 }, () => ({ ...questions[1], id: randomUUID() })),
  ])
    assert.throws(() => applicationQuestionsSchema.parse(input));
});

test("answers reject missing required, duplicate, unknown and forged choices and copy snapshots", () => {
  for (const input of [
    [],
    [{ questionId: questions[0]!.id, value: " " }],
    [{ questionId: questions[0]!.id, value: "운영자" }],
    [{ questionId: randomUUID(), value: "두뇌형" }],
    [
      { questionId: questions[0]!.id, value: "두뇌형" },
      { questionId: questions[0]!.id, value: "피지컬형" },
    ],
    [
      { questionId: questions[0]!.id, value: "두뇌형" },
      { questionId: questions[1]!.id, value: "가".repeat(1001) },
    ],
  ])
    assert.throws(() => snapshotApplicationAnswers(questions, input));
  const snapshots = snapshotApplicationAnswers(questions, [
    { questionId: questions[0]!.id, value: " 두뇌형 " },
  ]);
  assert.equal(snapshots[0]!.answer, "두뇌형");
  assert.equal(
    snapshotApplicationAnswers(questions, [
      { questionId: questions[0]!.id.toUpperCase(), value: "두뇌형" },
    ])[0]!.answer,
    "두뇌형",
  );
  assert.equal(snapshots[1]!.answer, "");
  questions[0]!.options[0] = "변경된 선택지";
  assert.equal(snapshots[0]!.options[0], "두뇌형");
});

test("server copies the member profile into applications and hides it from other visitors", async () => {
  await config();
  const result = await service.apply(attendee, postId, await form(), null);
  assert.equal(result.application!.attendeeName, "내 닉네임");
  assert.equal(result.application!.contact, phone);
  assert.equal(result.application!.answers[0]!.answer, "두뇌형");
  assert.equal(result.application!.questionnaireCompleted, true);
  assert.equal(result.applicantProfile!.ready, true);
  const anonymous = await service.overview(null, postId);
  assert.equal(anonymous.applicantProfile, null);
  assert.equal(anonymous.application, null);
  const another = await service.overview(outsider, postId);
  assert.equal(another.applicantProfile!.nickname, "다른 참가자");
  assert.equal(another.application, null);
  await assert.rejects(service.dashboard(outsider, postId), code("FORBIDDEN"));
  const dashboard = await service.dashboard(owner, postId);
  assert.equal(dashboard.attendees[0]!.answers[0]!.prompt, questions[0]!.prompt);
  const room = JSON.stringify(await service.room(attendee, postId));
  assert.equal(room.includes(phone), false);
  assert.equal(room.includes(questions[0]!.prompt), false);
});

test("missing or unconsented member information requires onboarding before applying", async () => {
  await config();
  const value = await form();
  await db
    .update(schema.profiles)
    .set({ phoneNumber: null, profileCompletedAt: null })
    .where(eq(schema.profiles.id, attendee));
  assert.equal((await service.overview(attendee, postId)).applicantProfile!.ready, false);
  await assert.rejects(service.apply(attendee, postId, value, null), code("VALIDATION"));
  await db
    .update(schema.profiles)
    .set({ phoneNumber: phone, onboardingConsentAt: null })
    .where(eq(schema.profiles.id, attendee));
  await assert.rejects(service.apply(attendee, postId, value, null), code("VALIDATION"));
  assert.equal((await service.overview(attendee, postId)).application, null);
});

test("stale question versions conflict; submitted snapshots survive question and profile edits and retries", async () => {
  await config();
  const stale = await form();
  await service.configure(owner, postId, {
    amountKRW: 0,
    capacity: 3,
    open: true,
    questions: [{ ...questions[0]!, prompt: "변경한 질문" }, questions[1]!],
  });
  await assert.rejects(service.apply(attendee, postId, stale, null), code("CONFLICT"));
  const fresh = await form();
  const one = (await service.apply(attendee, postId, fresh, null)).application!;
  await service.configure(owner, postId, { amountKRW: 0, capacity: 3, open: false, questions: [] });
  await db
    .update(schema.profiles)
    .set({ nickname: "변경한 닉네임", phoneNumber: "01088887777" })
    .where(eq(schema.profiles.id, attendee));
  const retry = (await service.apply(attendee, postId, fresh, null)).application!;
  assert.equal(retry.id, one.id);
  assert.deepEqual(retry.answers, one.answers);
  assert.equal(retry.attendeeName, "내 닉네임");
  assert.equal(retry.contact, phone);
  const [stored] = await db
    .select()
    .from(schema.eventApplications)
    .where(eq(schema.eventApplications.id, one.id));
  await assert.rejects(
    db
      .update(schema.eventApplications)
      .set({ answers: [] })
      .where(eq(schema.eventApplications.id, stored!.id)),
  );
  await assert.rejects(
    db
      .update(schema.eventApplications)
      .set({ questionnaireVersion: "forged" })
      .where(eq(schema.eventApplications.id, stored!.id)),
  );
});

test("omitting questions from quick settings preserves the organizer's questionnaire", async () => {
  const first = await config();
  const next = await service.configure(owner, postId, { amountKRW: 0, capacity: 4, open: true });
  assert.deepEqual(next.config!.questions, first.config!.questions);
  assert.equal(next.config!.questionnaireVersion, first.config!.questionnaireVersion);
});

test("manual external approval uses submitted answer snapshots even after questionnaire edits", async () => {
  await config(true);
  const submitted = await service.claimExternal(attendee, postId, {
    ...(await form()),
    externalReference: "member-first",
  });
  assert.equal(submitted.application!.status, "pending_approval");
  await service.configure(owner, postId, { amountKRW: 0, capacity: 3, open: true, questions: [] });
  await service.decideExternal(owner, submitted.application!.id, {
    decision: "approve",
    paymentChecked: true,
  });
  const confirmed = (await service.overview(attendee, postId)).application!;
  assert.equal(confirmed.status, "confirmed");
  assert.deepEqual(confirmed.answers, submitted.application!.answers);
  assert.equal((await service.room(attendee, postId)).canWrite, false);
});

test("payment-first external applications cannot be approved or join until the member submits required answers", async () => {
  await config(true, "automatic");
  assert.equal((await paidFirst()).status, "pending_approval");
  const pending = (await service.overview(attendee, postId)).application!;
  assert.equal(pending.questionnaireCompleted, false);
  assert.deepEqual(pending.answers, []);
  await assert.rejects(service.room(attendee, postId), code("FORBIDDEN"));
  await assert.rejects(
    service.decideExternal(owner, pending.id, { decision: "approve", paymentChecked: true }),
    code("CONFLICT"),
  );
  const value = await form();
  await assert.rejects(
    service.claimExternal(attendee, postId, {
      ...value,
      answers: [],
      externalReference: "order-first",
    }),
  );
  assert.equal(
    (await service.overview(attendee, postId)).application!.questionnaireCompleted,
    false,
  );
  const completed = await service.claimExternal(attendee, postId, {
    ...value,
    externalReference: "order-first",
  });
  assert.equal(completed.application!.id, pending.id);
  assert.equal(completed.application!.status, "confirmed");
  assert.equal(completed.application!.attendeeName, "내 닉네임");
  assert.equal(completed.application!.contact, phone);
  assert.equal(completed.application!.questionnaireCompleted, true);
  assert.equal((await service.room(attendee, postId)).canWrite, false);
  const retry = await service.claimExternal(attendee, postId, {
    ...value,
    externalReference: "order-first",
  });
  assert.deepEqual(retry.application!.answers, completed.application!.answers);
});

test("a paid external submission remains in review when the event fills before answers arrive", async () => {
  await config(true, "automatic");
  await paidFirst();
  await service.configure(owner, postId, {
    amountKRW: 0,
    capacity: 1,
    open: true,
    approvalMode: "automatic",
  });
  const outsiderEvent = await service.overview(outsider, postId);
  const outsiderSubmission = await service.claimExternal(outsider, postId, {
    ...base,
    questionnaireVersion: outsiderEvent.config!.questionnaireVersion,
    answers: [{ questionId: questions[0]!.id, value: "피지컬형" }],
    externalReference: "other-order",
  });
  await service.decideExternal(owner, outsiderSubmission.application!.id, {
    decision: "approve",
    paymentChecked: true,
  });
  const completed = await service.claimExternal(attendee, postId, {
    ...(await form()),
    externalReference: "order-first",
  });
  assert.equal(completed.application!.status, "review");
  assert.equal(completed.application!.questionnaireCompleted, true);
  await assert.rejects(service.room(attendee, postId), code("FORBIDDEN"));
});
