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
      !key ||
      key.startsWith("sb_secret_") ||
      !["http:", "https:"].includes(origin.protocol) ||
      origin.username ||
      origin.password
    )
      return null;
    if (origin.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(origin.hostname))
      return null;
    if (key.startsWith("eyJ")) {
      const part = key.split(".")[1];
      if (!part || JSON.parse(Buffer.from(part, "base64url").toString("utf8")).role !== "anon")
        return null;
    }
    return { url: url.origin, key, origin: origin.origin, secure: origin.protocol === "https:" };
  } catch {
    return null;
  }
}
