import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../src/db/connection";
import { profiles } from "../../src/db/schema";
import { memberSafety, moderationAudit, staffRoles } from "../../src/db/safety-schema";
import { membershipActive } from "../../src/domain/safety";

export const staffChangeSchema = z
  .strictObject({
    publicId: z.uuid(),
    role: z.enum(["admin", "moderator", "none"]),
    expectedRole: z.enum(["admin", "moderator", "none"]).optional(),
    reason: z.string().trim().min(5).max(500).optional(),
    apply: z.boolean().default(false),
  })
  .refine((value) => !value.apply || (!!value.expectedRole && !!value.reason), {
    message: "Apply requires expected role and reason.",
  });

/** Trusted server CLI only. There is intentionally no HTTP bootstrap endpoint. */
export async function changeStaffRole(db: Database, input: unknown) {
  const value = staffChangeSchema.parse(input);
  return db.transaction(async (tx) => {
    if (value.apply) await tx.execute(sql`select pg_advisory_xact_lock(192004, 1)`);
    const [profile] = await tx
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.publicId, value.publicId));
    if (!profile) throw new Error("Member not found.");
    const [state] = await tx.select().from(memberSafety).where(eq(memberSafety.userId, profile.id));
    if (value.role !== "none" && !membershipActive(state))
      throw new Error("Only active accounts can receive staff access.");
    const [current] = await tx.select().from(staffRoles).where(eq(staffRoles.userId, profile.id));
    const previousRole = current?.role ?? "none";
    if (value.apply && value.expectedRole !== previousRole)
      throw new Error("Role changed. Run dry-run again.");
    const changed = previousRole !== value.role;
    if (value.apply && changed) {
      if (previousRole === "admin" && value.role !== "admin") {
        const admins = await tx
          .select({ id: staffRoles.userId })
          .from(staffRoles)
          .leftJoin(memberSafety, eq(memberSafety.userId, staffRoles.userId))
          .where(eq(staffRoles.role, "admin"));
        let remaining = 0;
        for (const admin of admins) {
          if (admin.id === profile.id) continue;
          const [safety] = await tx
            .select()
            .from(memberSafety)
            .where(eq(memberSafety.userId, admin.id));
          if (membershipActive(safety)) remaining++;
        }
        if (!remaining) throw new Error("Cannot remove the last active administrator.");
      }
      if (value.role === "none")
        await tx.delete(staffRoles).where(eq(staffRoles.userId, profile.id));
      else
        await tx
          .insert(staffRoles)
          .values({ userId: profile.id, role: value.role })
          .onConflictDoUpdate({ target: staffRoles.userId, set: { role: value.role } });
      await tx.insert(moderationAudit).values({
        action: "staff_role_change",
        targetType: "player",
        targetId: value.publicId,
        reason: `Server CLI: ${previousRole} -> ${value.role}. ${value.reason}`,
      });
    }
    return {
      publicId: value.publicId,
      previousRole,
      requestedRole: value.role,
      changed,
      applied: value.apply && changed,
    };
  });
}
