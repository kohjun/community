const UUID_SEGMENT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_SEGMENT_RE = /^[0-9]{1,20}$/;
const OPAQUE_TOKEN_RE = /^[A-Za-z0-9_-]{24,}$/;

/**
 * Strips query parameters/hashes (which may hold OAuth codes, search queries, or return URLs)
 * and replaces resource IDs/UUIDs/tokens with stable route placeholders.
 */
export function sanitizeRoutePath(input: string): string {
  const withoutHash = input.split("#")[0] ?? "";
  const withoutQuery = withoutHash.split("?")[0] ?? "";
  if (!withoutQuery || withoutQuery === "/") return "/";
  const normalized = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  const segments = normalized.split("/").map((segment, index) => {
    if (index === 0 || !segment) return segment;
    if (UUID_SEGMENT_RE.test(segment)) return ":id";
    if (NUMERIC_SEGMENT_RE.test(segment)) return ":id";
    if (OPAQUE_TOKEN_RE.test(segment)) return ":token";
    return segment;
  });
  return segments.join("/") || "/";
}

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const KR_PHONE_RE = /\b01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const POSTGRES_URL_RE = /postgres(?:ql)?:\/\/[^\s'"]+/gi;

/** Redacts common PII and credential shapes from arbitrary strings before writing a log. */
export function scrubSensitiveStrings(value: string): string {
  return value
    .replace(POSTGRES_URL_RE, "[database-url]")
    .replace(BEARER_RE, "Bearer [redacted]")
    .replace(JWT_RE, "[jwt]")
    .replace(EMAIL_RE, "[email]")
    .replace(KR_PHONE_RE, "[phone]");
}
