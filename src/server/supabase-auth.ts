import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { authConfiguration } from "./auth-config";
export async function supabaseAuth() {
  const config = authConfiguration();
  if (!config) return null;
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: config.secure, path: "/" },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        try {
          for (const { name, value, options } of values) store.set(name, value, options);
        } catch {
          /* Proxy refreshes cookies before Server Component rendering. */
        }
      },
    },
  });
}
