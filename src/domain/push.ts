import { z } from "zod";

export const pushPreferencesSchema = z.strictObject({
  comments: z.boolean(),
  announcements: z.boolean(),
  participation: z.boolean(),
  // Older clients only sent the first three settings. Missing fields preserve
  // the saved value; they must not silently enable a previously disabled alert.
  subscriptions: z.boolean().optional(),
  reminders: z.boolean().optional(),
});
export interface PushPreferences {
  comments: boolean;
  announcements: boolean;
  participation: boolean;
  subscriptions: boolean;
  reminders: boolean;
}
export interface PushSettingsView {
  enabled: boolean;
  publicKey: string | null;
  preferences: PushPreferences;
  subscriptions: number;
  currentDevice: boolean;
}
export const DEFAULT_PUSH_PREFERENCES: PushPreferences = {
  comments: true,
  announcements: true,
  participation: true,
  subscriptions: true,
  reminders: true,
};
export const endpointInputSchema = z.strictObject({ endpoint: z.string().min(12).max(2048) });
export const pushSubscriptionSchema = z.strictObject({
  endpoint: z.string().min(12).max(2048),
  expirationTime: z.number().int().nonnegative().max(8_640_000_000_000_000).nullable().optional(),
  keys: z.strictObject({
    p256dh: z
      .string()
      .min(87)
      .max(88)
      .regex(/^[A-Za-z0-9_-]{87}=?$/),
    auth: z
      .string()
      .min(22)
      .max(24)
      .regex(/^[A-Za-z0-9_-]{22}(==)?$/),
  }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
