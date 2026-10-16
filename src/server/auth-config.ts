/** Only identifies supported browser-key formats. Supabase verifies legacy JWT signatures. */
function browserKey(key: string | undefined): key is string {
  if (!key || /[\s\u0000-\u001f\u007f]/.test(key)) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  const parts = key.split(".");
  if (
    parts.length !== 3 ||
    !parts.every(
      (part) =>
        /^[A-Za-z0-9_-]+$/.test(part) &&
        Buffer.from(part, "base64url").toString("base64url") === part,
    )
  )
    return false;
  try {
    const header: unknown = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8"));
    const payload: unknown = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
    if (
      !header ||
      typeof header !== "object" ||
      Array.isArray(header) ||
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload)
    )
      return false;
    const metadata = header as Record<string, unknown>;
    return (
      metadata.alg === "HS256" &&
      (metadata.typ === undefined || metadata.typ === "JWT") &&
      (payload as Record<string, unknown>).role === "anon"
    );
  } catch {
    return false;
  }
}

export function authConfiguration(env: Record<string, string | undefined> = process.env) {
  if (env.SLIPER_AUTH_MODE !== "supabase" || env.LOCAL_DATABASE === "1") return null;
  try {
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    const origin = new URL(env.APP_ORIGIN ?? "");
    const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !browserKey(key) ||
      !["http:", "https:"].includes(origin.protocol) ||
      origin.username ||
      origin.password
    )
      return null;
    if (origin.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(origin.hostname))
      return null;
    return { url: url.origin, key, origin: origin.origin, secure: origin.protocol === "https:" };
  } catch {
    return null;
  }
}
