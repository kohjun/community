export interface ReleaseReadinessCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

/** Static configuration evidence only. It is never a release approval or a connection probe. */
export interface ReleaseReadiness {
  checkedAt: string;
  scope: "configuration-only";
  checks: ReleaseReadinessCheck[];
  summary: { pass: number; warn: number; fail: number };
  externalVerification: "not-performed";
}
