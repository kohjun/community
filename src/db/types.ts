import type {
  bookmarks,
  categories,
  comments,
  mediaAssets,
  notifications,
  postDailyViews,
  postLikes,
  posts,
  profiles,
} from "./schema";

import type { videoAssets } from "./video-schema";

// Internal storage types. Never use these as a public API response or form input.
export type ProfileRecord = typeof profiles.$inferSelect;
export type CategoryRecord = typeof categories.$inferSelect;
export type PostRecord = typeof posts.$inferSelect;
export type NewPostRecord = typeof posts.$inferInsert;
export type CommentRecord = typeof comments.$inferSelect;
export type NewCommentRecord = typeof comments.$inferInsert;
export type MediaAssetRecord = typeof mediaAssets.$inferSelect;
export type VideoAssetRecord = typeof videoAssets.$inferSelect;
export type PostLikeRecord = typeof postLikes.$inferSelect;
export type BookmarkRecord = typeof bookmarks.$inferSelect;
export type PostDailyViewRecord = typeof postDailyViews.$inferSelect;
export type NotificationRecord = typeof notifications.$inferSelect;
