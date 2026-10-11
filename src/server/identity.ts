import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDatabase } from "../db/client";
import { memberSafety } from "../db/safety-schema";
import { membershipActive } from "../domain/safety";
import {
  LOCAL_TEST_SESSION_COOKIE,
  isLocalTestEnvironment,
  loadLocalTestAccount,
  readLocalTestSession,
} from "./local-test-auth";
import { allowedLocalTestHost } from "./local-test-access";
import { supabaseAuth } from "./supabase-auth";
export const LOCAL_ACTOR_ID = "00000000-0000-4000-8000-000000000001";
// Identity is verified by Auth; account restrictions are checked separately in the database.
export const authenticatedActor = cache(async (): Promise<string | null> => {
  const client = await supabaseAuth();
  if (client) {
    const { data, error } = await client.auth.getUser();
    return error ? null : (data.user?.id ?? null);
  }
  if (!isLocalTestEnvironment()) return null;
  const host = (await headers()).get("host");
  if (!allowedLocalTestHost(host)) return null;
  const token = (await cookies()).get(LOCAL_TEST_SESSION_COOKIE)?.value;
  if (token !== undefined) {
    const account = loadLocalTestAccount();
    if (!account || !host) return null;
    return readLocalTestSession(token, account, host)?.userId ?? null;
  }
  return host === "127.0.0.1:3000" || host === "localhost:3000" ? LOCAL_ACTOR_ID : null;
});
export const currentActor = cache(async (): Promise<string | null> => {
  const actor = await authenticatedActor();
  if (!actor) return null;
  const [state] = await getDatabase()
    .select()
    .from(memberSafety)
    .where(eq(memberSafety.userId, actor));
  return membershipActive(state) ? actor : null;
});
