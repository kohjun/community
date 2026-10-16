import type { Database } from "../db/connection";
import type { ReleaseReadiness } from "../domain/release-readiness";
import { analyticsService } from "./analytics-service";
import { deploymentReadiness } from "./deployment-readiness";

/** Do not probe integrations, write credentials or return raw environment settings. */
export function releaseReadinessService(
  db: Database,
  environment: Record<string, string | undefined> = process.env,
) {
  return {
    async snapshot(actor: string | null): Promise<ReleaseReadiness> {
      await analyticsService(db).allowedAdmin(actor);
      const checks = deploymentReadiness(environment).map(({ id, status, message }) => ({
        id,
        status,
        message,
      }));
      const summary = { pass: 0, warn: 0, fail: 0 };
      for (const check of checks) summary[check.status]++;
      return {
        checkedAt: new Date().toISOString(),
        scope: "configuration-only",
        checks,
        summary,
        externalVerification: "not-performed",
      };
    },
  };
}
