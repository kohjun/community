import { z } from "zod";
import type { CategorySlug } from "./categories";

export const libraryEvidenceQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  version: z.coerce.number().int().min(1).optional(),
});

/** Operating evidence exposes aggregate facts, never the edition or attendee identities. */
export interface LibraryEvidenceItem {
  postId: string;
  title: string;
  category: CategorySlug;
  location: string;
  startsAt: string | null;
  endsAt: string | null;
  completedAt: string;
  versionNumber: number | null;
  attended: number;
  qrAttended: number;
  managerAttended: number;
  reviewCount: number;
  averageRating: number | null;
}

export interface LibraryEvidencePage {
  items: LibraryEvidenceItem[];
  total: number;
  page: number;
  pageCount: number;
  versions: Array<{ number: number; caseCount: number }>;
  legacyCount: number;
}
