/** Offline repository checks. Findings never contain matched credential values. */
export interface SecretFinding {
  path: string;
  line: number;
  reason: string;
}
export interface KnownSecret {
  name: string;
  value: string;
}
const credentialPatterns: Array<[string, RegExp]> = [
  ["Supabase server secret", /\bsb_secret_[A-Za-z0-9_-]{22,}\b/g],
  ["GitHub access token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/g],
  [
    "Provider API secret",
    /\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{28,}|sk_live_[A-Za-z0-9]{20,}|rk_live_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{30,})\b/g,
  ],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["Private key material", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
];
export function credentialPath(file: string): boolean {
  const name = file.replaceAll("\\", "/").toLowerCase();
  const base = name.split("/").at(-1) ?? "";
  return (
    ((base === ".env" || base.startsWith(".env.")) && base !== ".env.example") ||
    name.startsWith(".local/") ||
    name.startsWith("secrets/") ||
    /\.(?:pem|p12|pfx|key)$/.test(base) ||
    /^(?:id_rsa|id_ed25519|credentials\.json|service-account.*\.json)$/.test(base)
  );
}
export function secretFindings(
  file: string,
  content: string,
  known: KnownSecret[] = [],
): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const add = (index: number, reason: string) => {
    const line = content.slice(0, index).split("\n").length;
    if (!findings.some((row) => row.line === line && row.reason === reason))
      findings.push({ path: file, line, reason });
  };
  if (credentialPath(file)) add(0, "Private environment or credential file must not be committed");
  for (const [reason, pattern] of credentialPatterns) {
    for (const match of content.matchAll(new RegExp(pattern.source, pattern.flags)))
      add(match.index, reason);
  }
  for (const match of content.matchAll(
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{32,}\b/g,
  )) {
    try {
      const claims = JSON.parse(
        Buffer.from(match[0].split(".")[1]!, "base64url").toString("utf8"),
      ) as { role?: string };
      // Legacy Supabase anon keys are public; service-role and session tokens are private.
      if (claims.role !== "anon") add(match.index, "Private JWT or Supabase service-role token");
    } catch {
      add(match.index, "Hardcoded JWT credential");
    }
  }
  for (const match of content.matchAll(
    /\b(?:postgres(?:ql)?|mysql|rediss?|amqps?):\/\/[^\s"'`<>]+/g,
  )) {
    try {
      const url = new URL(match[0]);
      const password = decodeURIComponent(url.password);
      if (/\$\{[A-Za-z_][A-Za-z0-9_.]*\}/.test(password)) continue;
      const exampleHost =
        /(?:^|\.)(?:example|invalid|test)$/.test(url.hostname) ||
        /^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
      const examplePassword =
        /^(?:password|runtime-password|migration-password|private-password|test-password|demo-password|YOUR_PASSWORD|change-me|p)$/.test(
          password,
        );
      if (password && !exampleHost && !examplePassword)
        add(match.index, "Hardcoded connection password");
    } catch {
      /* Configuration validation handles malformed URLs. */
    }
  }
  for (const secret of known) {
    if (secret.value.length < 8) continue;
    const index = content.indexOf(secret.value);
    if (index >= 0) add(index, `Matches configured private variable ${secret.name}`);
  }
  return findings;
}
