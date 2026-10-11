import { z } from "zod";

export const libraryTestPurchaseSchema = z.strictObject({
  version: z.number().int().positive(),
  note: z.string().trim().max(500).default(""),
  consent: z.literal(true),
});
