/** Prevent a configured cloud runtime from silently connecting to development storage. */
export function assertCloudDatabase(
  url: string,
  env: Record<string, string | undefined> = process.env,
) {
  if (env.SLIPER_CLOUD_ONLY !== "true") return;
  try {
    const parsed = new URL(url);
    const role = decodeURIComponent(parsed.username).split(".")[0];
    if (
      env.SLIPER_AUTH_MODE !== "supabase" ||
      env.LOCAL_DATABASE !== "0" ||
      !["postgres:", "postgresql:"].includes(parsed.protocol) ||
      (!parsed.hostname.endsWith(".supabase.com") && !parsed.hostname.endsWith(".supabase.co")) ||
      !parsed.username ||
      !parsed.password ||
      ["postgres", "supabase_admin"].includes(role ?? "") ||
      !["require", "verify-full", "verify-ca"].includes(parsed.searchParams.get("sslmode") ?? "")
    )
      throw new Error();
  } catch {
    throw new Error(
      "Cloud runtime requires Supabase authentication and a restricted TLS database connection.",
    );
  }
}
