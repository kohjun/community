import type { CategorySlug } from "./categories";
import type { CommunityPost } from "./community";
export const PROFILE_AGE_BANDS = ["20s", "30s", "40s", "50plus"] as const;
export const PROFILE_GENDERS = ["female", "male", "other"] as const;
export type ProfileAgeBand = (typeof PROFILE_AGE_BANDS)[number];
export type ProfileGender = (typeof PROFILE_GENDERS)[number];

/** Number normalization checks format only; it does not prove possession. */
export function normalizePhoneNumber(value: string): string | null {
  if (!/^[\d+\s()\-]+$/.test(value.trim())) return null;
  let number = value.replace(/[\s()\-]/g, "");
  if (number.startsWith("+82")) number = "0" + number.slice(3).replace(/^0/, "");
  if (/^010\d{8}$/.test(number) || /^01[16789]\d{7,8}$/.test(number)) return number;
  return null;
}
export function isProfileReadyForApplication(profile: {
  nickname: string;
  phoneNumber: string | null;
  profileCompletedAt: string | Date | null;
  onboardingConsentAt: string | Date | null;
}): boolean {
  return (
    profile.nickname.trim().length >= 2 &&
    profile.nickname.trim().length <= 24 &&
    !!profile.phoneNumber &&
    !!normalizePhoneNumber(profile.phoneNumber) &&
    !!profile.profileCompletedAt &&
    !!profile.onboardingConsentAt
  );
}
/** Accept only navigation within this site, including an event's return query. */
export function safeProfileReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/")) return "/mypage";
  try {
    const url = new URL(value, "https://sliper.local");
    let pathname = url.pathname;
    for (let i = 0; i < 2; i++) pathname = decodeURIComponent(pathname);
    if (
      url.origin !== "https://sliper.local" ||
      pathname.startsWith("//") ||
      /[\\\u0000-\u001f\u007f]/.test(value + pathname) ||
      ["/signup", "/login"].includes(url.pathname)
    )
      return "/mypage";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/mypage";
  }
}
export interface MyProfile {
  publicId: string;
  /** Private member details: never add these to public player DTOs. */
  phoneNumber: string | null;
  phoneVerifiedAt: string | null;
  profileCompletedAt: string | null;
  onboardingConsentAt: string | null;
  ageBand: ProfileAgeBand | null;
  gender: ProfileGender | null;
  nickname: string;
  bio: string;
  region: string;
  avatar: "spark" | "heart" | "game" | "music" | "planet" | "smile";
  photoSrc: string | null;
  interests: CategorySlug[];
  joinedAt: string;
  points: number;
  earned: { posts: number; comments: number; votes: number };
  counts: { posts: number; comments: number; votes: number; bookmarks: number; visits: number };
  recentPosts: CommunityPost[];
  savedPosts: CommunityPost[];
  recentComments: {
    id: string;
    postId: string;
    postTitle: string;
    body: string;
    createdAt: string;
  }[];
  history: { reason: string; points: number; createdAt: string }[];
}
