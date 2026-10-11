import { previewTitleSql } from "./discussion-policy";
import { and, desc, eq, exists, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { activityEvents, bookmarks, comments, posts, profilePhotos, profiles } from "../db/schema";
import { profileInputSchema, onboardingInputSchema } from "../domain/validation";
import type { MyProfile } from "../domain/profile";
import type { PostProjector } from "./post-reader";
import { preciseTimestamp } from "./pagination";
import { AppError, requireActor } from "./errors";
import { awardActivity } from "./activity";
import { memberSafety } from "../db/safety-schema";
import { POLICY_VERSION } from "../domain/safety";
export function profileService(db: Database, projectPosts: PostProjector) {
  async function me(actor: string | null): Promise<MyProfile> {
    const userId = requireActor(actor);
    const [profile] = await db.select().from(profiles).where(eq(profiles.id, userId));
    if (!profile) throw new AppError("NOT_FOUND", "프로필을 찾을 수 없어요.");
    const [photo] = await db
      .select({ id: profilePhotos.id })
      .from(profilePhotos)
      .where(eq(profilePhotos.userId, userId));
    const [stats] = await db
      .select({
        points: sql<number>`coalesce(sum(${activityEvents.points}),0)::int`,
        visits: sql<number>`count(*) filter (where ${activityEvents.reason}='visit')::int`,
        earnedPosts: sql<number>`count(*) filter (where ${activityEvents.reason}='post')::int`,
        earnedComments: sql<number>`count(*) filter (where ${activityEvents.reason}='comment')::int`,
        earnedVotes: sql<number>`count(*) filter (where ${activityEvents.reason}='vote')::int`,
      })
      .from(activityEvents)
      .where(eq(activityEvents.userId, userId));
    const [counts] = await db
      .select({
        posts: sql<number>`(select count(*)::int from sliper.posts where author_id=${userId} and status='published')`,
        comments: sql<number>`(select count(*)::int from sliper.comments c join sliper.posts p on p.id=c.post_id where c.author_id=${userId} and c.status='published' and p.status='published')`,
        votes: sql<number>`(select count(*)::int from sliper.poll_votes v join sliper.posts p on p.id=v.post_id where v.user_id=${userId} and p.status='published')`,
        bookmarks: sql<number>`(select count(*)::int from sliper.bookmarks b join sliper.posts p on p.id=b.post_id where b.user_id=${userId} and p.status='published')`,
      })
      .from(profiles)
      .where(eq(profiles.id, userId));
    const [recentPosts, savedPosts, recentComments, history] = await Promise.all([
      projectPosts(eq(posts.authorId, userId), userId, 20),
      projectPosts(
        exists(
          db
            .select({ id: bookmarks.postId })
            .from(bookmarks)
            .where(and(eq(bookmarks.postId, posts.id), eq(bookmarks.userId, userId))),
        ),
        userId,
        20,
      ),
      db
        .select({
          id: comments.id,
          postId: comments.postId,
          postTitle: previewTitleSql,
          body: comments.bodyMarkdown,
          createdAt: preciseTimestamp(comments.createdAt),
        })
        .from(comments)
        .innerJoin(posts, eq(posts.id, comments.postId))
        .where(
          and(
            eq(comments.authorId, userId),
            eq(comments.status, "published"),
            eq(posts.status, "published"),
          ),
        )
        .orderBy(desc(comments.createdAt))
        .limit(20),
      db
        .select({
          reason: activityEvents.reason,
          points: activityEvents.points,
          createdAt: preciseTimestamp(activityEvents.createdAt),
        })
        .from(activityEvents)
        .where(eq(activityEvents.userId, userId))
        .orderBy(desc(activityEvents.createdAt))
        .limit(20),
    ]);
    return {
      publicId: profile.publicId,
      phoneNumber: profile.phoneNumber,
      phoneVerifiedAt: profile.phoneVerifiedAt?.toISOString() ?? null,
      profileCompletedAt: profile.profileCompletedAt?.toISOString() ?? null,
      onboardingConsentAt: profile.onboardingConsentAt?.toISOString() ?? null,
      ageBand: profile.ageBand as MyProfile["ageBand"],
      gender: profile.gender as MyProfile["gender"],
      nickname: profile.nickname,
      bio: profile.bio,
      region: profile.region,
      avatar: profile.avatar as MyProfile["avatar"],
      photoSrc: photo ? `/api/profile-photos/${photo.id}` : null,
      interests: profile.interests as MyProfile["interests"],
      joinedAt: profile.createdAt.toISOString(),
      points: stats?.points ?? 0,
      earned: {
        posts: stats?.earnedPosts ?? 0,
        comments: stats?.earnedComments ?? 0,
        votes: stats?.earnedVotes ?? 0,
      },
      counts: { ...counts!, visits: stats?.visits ?? 0 },
      recentPosts,
      savedPosts,
      recentComments,
      history,
    };
  }
  async function saveProfile(actor: string | null, input: unknown, onboarding: boolean) {
    const userId = requireActor(actor);
    const parsed = onboarding
      ? onboardingInputSchema.parse(input)
      : profileInputSchema.parse(input);
    const { consent: _consent, ...value } = { ...parsed, consent: onboarding };
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userId))
        .for("update");
      if (!current) throw new AppError("NOT_FOUND", "프로필을 찾을 수 없어요.");
      const phoneNumber = value.phoneNumber === undefined ? current.phoneNumber : value.phoneNumber;
      const now = new Date();
      if (onboarding)
        await tx
          .insert(memberSafety)
          .values({ userId, policyVersion: POLICY_VERSION, consentAt: now })
          .onConflictDoUpdate({
            target: memberSafety.userId,
            set: { policyVersion: POLICY_VERSION, consentAt: now },
          });
      const onboardingConsentAt = onboarding
        ? (current.onboardingConsentAt ?? now)
        : current.onboardingConsentAt;
      const ready = !!phoneNumber && !!onboardingConsentAt;
      await tx
        .update(profiles)
        .set({
          ...value,
          phoneNumber,
          phoneVerifiedAt: phoneNumber === current.phoneNumber ? current.phoneVerifiedAt : null,
          onboardingConsentAt,
          profileCompletedAt: ready ? (current.profileCompletedAt ?? now) : null,
          updatedAt: now,
        })
        .where(eq(profiles.id, userId));
    });
    return me(userId);
  }
  async function updateProfile(actor: string | null, input: unknown) {
    return saveProfile(actor, input, false);
  }
  async function completeOnboarding(actor: string | null, input: unknown) {
    return saveProfile(actor, input, true);
  }
  async function visit(actor: string | null) {
    const userId = requireActor(actor);
    await db.transaction((tx) => awardActivity(tx, userId, "visit"));
    return me(userId);
  }
  return { me, updateProfile, completeOnboarding, visit };
}
