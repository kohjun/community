import { before, after } from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../../src/db/connection";
import { profiles } from "../../src/db/schema";
import { isProfileReadyForApplication, normalizePhoneNumber } from "../../src/domain/profile";

const developmentActor = "00000000-0000-4000-8000-000000000001";

/** Run HTTP suites sequentially: each owns this actor's temporary setup until after(). */
export function installDevelopmentProfileFixture() {
  let connection: ReturnType<typeof createDatabase> | null = null;
  let restore: Pick<
    typeof profiles.$inferSelect,
    "phoneNumber" | "phoneVerifiedAt" | "profileCompletedAt" | "onboardingConsentAt"
  > | null = null;
  let changed = false;
  before(async () => {
    const address = new URL(process.env.DATABASE_URL || "http://missing");
    if (
      process.env.LOCAL_DATABASE !== "1" ||
      process.env.SLIPER_AUTH_MODE !== "development" ||
      !["postgres:", "postgresql:"].includes(address.protocol) ||
      address.hostname !== "127.0.0.1" ||
      address.port !== "55432" ||
      address.pathname !== "/sliper_dev" ||
      process.env.APP_ORIGIN !== "http://127.0.0.1:3000"
    )
      throw new Error(
        "Temporary member information is restricted to the isolated local test database.",
      );
    connection = createDatabase(address.href, 1);
    await connection.db.transaction(async (tx) => {
      const [profile] = await tx
        .select({
          nickname: profiles.nickname,
          phoneNumber: profiles.phoneNumber,
          phoneVerifiedAt: profiles.phoneVerifiedAt,
          profileCompletedAt: profiles.profileCompletedAt,
          onboardingConsentAt: profiles.onboardingConsentAt,
        })
        .from(profiles)
        .where(eq(profiles.id, developmentActor))
        .for("update");
      if (!profile) throw new Error("The local development member fixture is missing.");
      if (isProfileReadyForApplication(profile)) return;
      restore = {
        phoneNumber: profile.phoneNumber,
        phoneVerifiedAt: profile.phoneVerifiedAt,
        profileCompletedAt: profile.profileCompletedAt,
        onboardingConsentAt: profile.onboardingConsentAt,
      };
      const existingPhone = profile.phoneNumber && normalizePhoneNumber(profile.phoneNumber);
      await tx
        .update(profiles)
        .set({
          phoneNumber: existingPhone ? profile.phoneNumber : "01012345678",
          phoneVerifiedAt: existingPhone ? profile.phoneVerifiedAt : null,
          profileCompletedAt: profile.profileCompletedAt ?? new Date(),
          onboardingConsentAt: profile.onboardingConsentAt ?? new Date(),
        })
        .where(eq(profiles.id, developmentActor));
      changed = true;
    });
  });
  after(async () => {
    if (!connection) return;
    try {
      if (changed && restore)
        await connection.db.update(profiles).set(restore).where(eq(profiles.id, developmentActor));
    } finally {
      await connection.close();
      connection = null;
      restore = null;
    }
  });
}
