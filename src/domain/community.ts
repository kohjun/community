import type { DiscussionType } from "./discussions";
import type { CategorySlug } from "./categories";
import type { LightningCategorySlug } from "./lightning-categories";
import type { PostDocument } from "./post-document";
import type { CursorPage, NotificationItem, PublicImage, PublicVideo } from "./contracts";

export interface CommunityPoll {
  question: string;
  options: { label: string; votes: number }[];
  total: number;
  selected: number | null;
}

// Public presentation models. Authentication subjects never leave the server.
export interface CommunityPost {
  id: string;
  category: CategorySlug;
  kind: "모집" | "후기" | "이야기" | "투표";
  verifiedParticipation?: {
    eventPostId: string;
    eventTitle: string;
    rating: number;
    templateEntryId: string | null;
    hostPublicId: string | null;
  };
  discussionType?: DiscussionType | null;
  acceptedAnswerId?: string | null;
  spoiler?: boolean;
  spoilerTitle?: string | null;
  spoilerSummary?: string | null;
  title: string;
  excerpt: string;
  body: string;
  bodyDocument?: PostDocument | null;
  author: string;
  anonymous: boolean;
  time: string;
  createdAt: string;
  updatedAt: string;
  likes: number;
  popularityScore?: number;
  views: number;
  comments: number;
  image?: string;
  images: PublicImage[];
  videos?: PublicVideo[];
  location?: string;
  eventDate?: string;
  meetupType?: "event" | "lightning";
  activityCategory?: LightningCategorySlug | null;
  distanceKm?: number | null;
  venueLatitude?: number | null;
  venueLongitude?: number | null;
  communityVenueId?: string | null;
  communityVenueVersion?: number | null;
  eventStartsAt?: string | null;
  eventCancelledAt?: string | null;
  eventAmountKRW?: number | null;
  eventAvailable?: boolean;
  applicationUrl: string | null;
  eventFee: string | null;
  contactInfo: string | null;
  topic: string | null;
  tags: string[];
  poll: CommunityPoll | null;
  featured: boolean;
  sample: boolean;
  isMine: boolean;
  isLiked: boolean;
  isBookmarked: boolean;
}

export interface CommunityComment {
  createdAt: string;
  replyCount: number;
  id: string;
  postId: string;
  parentId: string | null;
  author: string;
  anonymous: boolean;
  body: string;
  time: string;
  isMine: boolean;
  isDeleted: boolean;
}

export interface FeedQuery {
  category?: CategorySlug | undefined;
  kind?: CommunityPost["kind"] | undefined;
  discussionType?: DiscussionType | undefined;
  focus?: "all" | "unanswered" | "interests" | undefined;
  search?: string | undefined;
  topic?: string | undefined;
  tag?: string | undefined;
  view?: "home" | "popular" | "bookmarks" | "mine" | undefined;
  sort?: "latest" | "popular" | "nearest" | undefined;
  period?: "today" | "week" | "all" | undefined;
  rankingAt?: string | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
  radiusKm?: number | undefined;
  eventOnly?: boolean | undefined;
  meetupType?: "event" | "lightning" | undefined;
  activityCategory?: LightningCategorySlug | undefined;
  fromDate?: string | undefined;
  toDate?: string | undefined;
  minPriceKRW?: number | undefined;
  maxPriceKRW?: number | undefined;
  availableOnly?: boolean | undefined;
  cursor?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}

export interface FeedPagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface CommunityFeed {
  interestFeed?: "personalized" | "setup" | "login" | undefined;
  posts: CommunityPost[];
  featured: CommunityPost[];
  hot?: CommunityPost[];
  upcoming?: CommunityPost[];
  rankingAt?: string;
  nextCursor: string | null;
  pagination?: FeedPagination;
}

export interface CommunitySnapshot extends CommunityFeed {
  notifications: NotificationItem[];
  notificationNextCursor: string | null;
  unreadCount: number;
  canWrite: boolean;
  mode: "development" | "authenticated" | "readonly";
}

export interface CommunityDetail {
  post: CommunityPost;
  comments: CommunityComment[];
  acceptedAnswer?: CommunityComment | null;
  nextCommentCursor: string | null;
}

export interface PageQuery {
  cursor?: string | undefined;
  limit?: number | undefined;
}
export interface CommentPageQuery extends PageQuery {
  parentId?: string | null | undefined;
}
export interface InboxPage extends CursorPage<NotificationItem> {
  unreadCount: number;
}
export interface ReadReceipt {
  id: string | null;
  readAt: string;
  unreadCount: number;
}
export interface CommentMutation {
  post: CommunityPost;
  comment: CommunityComment;
  parent: CommunityComment | null;
}
