import type { Database } from "../db/connection";
import { eventSettings, posts } from "../db/schema";
import { lightningInputSchema } from "../domain/discovery";
import { awardActivity } from "./activity";
import { bindEventVenue } from "./event-venue-service";
import { AppError, requireActor } from "./errors";
export function lightningService(db: Database) {
  return {
    async create(actor: string | null, input: unknown) {
      const user = requireActor(actor),
        value = lightningInputSchema.parse(input);
      return db.transaction(async (tx) => {
        const now = Date.now(),
          startsAt = new Date(value.startsAt),
          endsAt = new Date(value.endsAt);
        if (startsAt.getTime() <= now || startsAt.getTime() > now + 7 * 86400000)
          throw new AppError("VALIDATION", "번개는 지금부터 7일 이내의 미래 일정으로 열어주세요.");
        const [post] = await tx
          .insert(posts)
          .values({
            authorId: user,
            categorySlug: value.categorySlug,
            tags: value.activityTags,
            kind: "모집",
            title: value.title,
            bodyMarkdown: value.description,
            location: value.location,
            eventFee: value.priceKRW === 0 ? "무료" : value.priceKRW.toLocaleString("ko-KR") + "원",
            applicationUrl: value.applicationUrl,
            eventDate: new Intl.DateTimeFormat("ko-KR", {
              timeZone: "Asia/Seoul",
              dateStyle: "medium",
              timeStyle: "short",
            }).format(startsAt),
          })
          .returning({ id: posts.id });
        const postId = post!.id;
        await tx.insert(eventSettings).values({
          postId,
          meetupType: "lightning",
          activityCategory: value.activityCategory ?? "other",
          venueLatitude: value.venue.latitude,
          venueLongitude: value.venue.longitude,
          startsAt,
          endsAt,
          amountKRW: value.priceKRW,
          capacity: value.capacity,
          open: true,
          approvalMode: "manual",
        });
        await bindEventVenue(tx, user, postId, value.venue);
        await awardActivity(tx, user, "post", postId);
        return {
          postId,
          externalUrl: value.applicationUrl,
          applicationUrl: `/events/${postId}`,
          managementUrl: `/management/events/${postId}`,
        };
      });
    },
  };
}
