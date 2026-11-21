import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { eq, inArray, sql } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import { eventSettings, posts, profiles } from "../src/db/schema";
import { JANUARY_RECRUITMENTS } from "../src/demo/january-recruitments";
import { imageStorageConfiguration } from "../src/server/image-storage-config";

const marker = "january-2027-recruitment";
const hostId = "6f027000-2027-4101-8100-000000000000";
const hostName = "슬리퍼 1월 샘플팀";
const ids = JANUARY_RECRUITMENTS.map(({ postId }) => postId);
const databaseUrl = new URL(process.env.DATABASE_URL ?? "http://missing");
const local = process.argv[2] === "--local";
const apply = local || process.argv[2] === "--apply";
if (local) {
  if (
    process.env.LOCAL_DATABASE !== "1" ||
    databaseUrl.host !== "127.0.0.1:55432" ||
    databaseUrl.pathname !== "/sliper_dev"
  )
    throw new Error("The local seed requires the isolated Sliper test database.");
} else if (
  process.env.SLIPER_CLOUD_ONLY !== "true" ||
  new URL(process.env.APP_ORIGIN ?? "http://missing").origin !== "https://sliper.kr"
) {
  throw new Error("The sample seed is scoped to the Sliper production service.");
}

const connection = createDatabase(databaseUrl.href, 1);
const day = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
});
const time = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

try {
  const previous = await connection.db
    .select({ id: posts.id, sample: posts.sample, authorId: posts.authorId })
    .from(posts)
    .where(inArray(posts.id, ids));
  if (previous.some((post) => !post.sample || post.authorId !== hostId))
    throw new Error("An existing post uses a reserved sample identifier.");
  if (!apply) {
    console.log(
      JSON.stringify({ samplePosts: ids.length, existing: previous.length, write: false }),
    );
  } else {
    if (local) {
      await connection.db.execute(
        sql`insert into auth.users (id) values (${hostId}) on conflict do nothing`,
      );
    } else {
      const config = imageStorageConfiguration("supabase");
      if (config.backend !== "supabase")
        throw new Error("Production Supabase configuration is missing.");
      const supabase = createClient(config.url, config.secretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const existing = await supabase.auth.admin.getUserById(hostId);
      if (existing.error && existing.error.status !== 404)
        throw new Error(`Unable to verify sample host (${existing.error.status ?? "unknown"}).`);
      const host = existing.data.user
        ? existing
        : await supabase.auth.admin.createUser({
            id: hostId,
            email: "january-recruitment-sample@example.com",
            password: randomBytes(32).toString("hex"),
            email_confirm: false,
            app_metadata: { sliper_seed: marker },
          });
      if (
        host.error ||
        host.data.user?.id !== hostId ||
        host.data.user.app_metadata.sliper_seed !== marker
      )
        throw new Error(
          `Unable to identify the dedicated sample host (${host.error?.status ?? "identity mismatch"}).`,
        );
    }
    await connection.db.transaction(async (tx) => {
      await tx
        .insert(profiles)
        .values({
          id: hostId,
          nickname: hostName,
          analyticsExcluded: true,
          bio: "슬리퍼의 2027년 1월 모집 샘플을 보여주는 계정이에요.",
        })
        .onConflictDoNothing();
      const [host] = await tx
        .select({ nickname: profiles.nickname, excluded: profiles.analyticsExcluded })
        .from(profiles)
        .where(eq(profiles.id, hostId));
      if (!host?.excluded || host.nickname !== hostName)
        throw new Error("Sample host profile mismatch.");

      for (const item of JANUARY_RECRUITMENTS) {
        const start = new Date(item.startsAt);
        const end = new Date(start.getTime() + item.durationMinutes * 60_000);
        const [latitude, longitude] = item.coordinates ?? [];
        const location = item.example.facts.find(([label]) => label === "장소")?.[1];
        const eventFee =
          item.type === "lightning"
            ? "현장 정산"
            : `${item.amountKRW.toLocaleString("ko-KR")}원 (예시)`;
        const [post] = await tx
          .insert(posts)
          .values({
            id: item.postId,
            authorId: hostId,
            kind: "모집",
            categorySlug: item.category,
            title: item.example.title,
            bodyMarkdown: `## 모임 소개\n${item.example.summary}\n\n${item.example.detail}`,
            location,
            eventDate: `${day.format(start)} ${time.format(start)}–${time.format(end)}`,
            eventFee,
            tags: ["1월 모임", item.example.category],
            featured: true,
            sample: true,
          })
          .onConflictDoNothing()
          .returning({ id: posts.id });
        if (!post) continue;
        await tx.insert(eventSettings).values({
          postId: item.postId,
          meetupType: item.type,
          activityCategory: item.activity,
          startsAt: start,
          endsAt: end,
          capacity: item.capacity,
          amountKRW: item.amountKRW,
          venueLatitude: latitude,
          venueLongitude: longitude,
          open: false,
          // A sample lightning record depicts a January opening within the normal seven-day window.
          ...(item.type === "lightning"
            ? { createdAt: new Date(start.getTime() - 3 * 86400000) }
            : {}),
        });
      }
    });
    const verified = await connection.db
      .select({
        id: posts.id,
        sample: posts.sample,
        open: eventSettings.open,
        type: eventSettings.meetupType,
      })
      .from(posts)
      .innerJoin(eventSettings, eq(posts.id, eventSettings.postId))
      .where(inArray(posts.id, ids));
    if (
      verified.length !== ids.length ||
      verified.some((post) => !post.sample || post.open) ||
      verified.filter((post) => post.type === "event").length !== 4
    )
      throw new Error("The sample publication did not verify.");
    console.log(JSON.stringify({ event: 4, lightning: 4, registrationsOpen: false, ids }));
  }
} finally {
  await connection.close();
}
