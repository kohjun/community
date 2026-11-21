import type { CategorySlug } from "@/domain/categories";
import type { LightningCategorySlug } from "@/domain/lightning-categories";
import type { MeetupType } from "@/domain/meetup-types";
import { EXAMPLES } from "./showcase";

type Entry = {
  exampleId: string;
  category: CategorySlug;
  day: number;
  hours: string;
  durationMinutes: number;
  capacity: number;
  amountKRW: number;
  activity?: LightningCategorySlug;
  coordinates?: readonly [number, number];
};

const schedule: Record<MeetupType, readonly Entry[]> = {
  event: [
    {
      exampleId: "event-mission",
      category: "race",
      day: 9,
      hours: "14:00",
      durationMinutes: 180,
      capacity: 16,
      amountKRW: 8000,
    },
    {
      exampleId: "event-detective",
      category: "mind-games",
      day: 15,
      hours: "19:30",
      durationMinutes: 150,
      capacity: 8,
      amountKRW: 12000,
    },
    {
      exampleId: "event-relay",
      category: "sports",
      day: 24,
      hours: "13:00",
      durationMinutes: 180,
      capacity: 20,
      amountKRW: 5000,
    },
    {
      exampleId: "event-cooking",
      category: "cooking",
      day: 30,
      hours: "16:00",
      durationMinutes: 150,
      capacity: 12,
      amountKRW: 15000,
    },
  ],
  lightning: [
    {
      exampleId: "lightning-board",
      category: "mind-games",
      day: 8,
      hours: "19:30",
      durationMinutes: 90,
      capacity: 4,
      amountKRW: 0,
      activity: "games",
      coordinates: [37.5496, 126.9138],
    },
    {
      exampleId: "lightning-photo",
      category: "travel",
      day: 16,
      hours: "15:40",
      durationMinutes: 80,
      capacity: 5,
      amountKRW: 0,
      activity: "photography",
      coordinates: [37.5397, 127.0017],
    },
    {
      exampleId: "lightning-quiz",
      category: "party",
      day: 23,
      hours: "15:00",
      durationMinutes: 90,
      capacity: 6,
      amountKRW: 0,
      activity: "social",
      coordinates: [37.5088, 127.1042],
    },
    {
      exampleId: "lightning-music",
      category: "music",
      day: 31,
      hours: "17:00",
      durationMinutes: 90,
      capacity: 5,
      amountKRW: 0,
      activity: "music",
      coordinates: [37.5442, 127.0374],
    },
  ],
};

export const JANUARY_RECRUITMENTS = (["event", "lightning"] as const).flatMap((type, group) =>
  schedule[type].map((entry, index) => ({
    ...entry,
    type,
    postId: `6f027000-2027-4101-8100-00000000000${group * 4 + index + 1}`,
    startsAt: `2027-01-${String(entry.day).padStart(2, "0")}T${entry.hours}:00+09:00`,
    example: EXAMPLES[type].find(({ id }) => id === entry.exampleId)!,
  })),
);

export function januaryRecruitmentSample(post: { id: string; sample: boolean }) {
  return post.sample ? JANUARY_RECRUITMENTS.find(({ postId }) => post.id === postId) : undefined;
}

export function isJanuaryRecruitmentSample(post: { id: string; sample: boolean }) {
  return !!januaryRecruitmentSample(post);
}
