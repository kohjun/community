import { createHmac, scrypt, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

export const LOCAL_TEST_SESSION_COOKIE = "sliper_test_session";
export const LOCAL_TEST_SESSION_MAX_AGE = 7 * 24 * 60 * 60;
const deriveKey = promisify(scrypt);
const canonicalBytes = (value: string, length: number) => {
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.length === length && decoded.toString("base64url") === value;
  } catch {
    return false;
  }
};
const encodedBytes = (length: number) =>
  z
    .string()
    .max(128)
    .refine((value) => canonicalBytes(value, length));
const accountSchema = z.strictObject({
  version: z.literal(1),
  username: z.literal("test@sliper.local"),
  userId: z.string().uuid(),
  passwordSalt: encodedBytes(32),
  passwordHash: encodedBytes(64),
  sessionSecret: encodedBytes(32),
  accountNonce: encodedBytes(16),
});
export type LocalTestAccount = z.infer<typeof accountSchema>;

// The test adapter cannot activate against a cloud database or production build.
export function isLocalTestEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  if (
    env.NODE_ENV !== "development" ||
    env.LOCAL_DATABASE !== "1" ||
    env.SLIPER_AUTH_MODE !== "development"
  )
    return false;
  try {
    const database = new URL(env.DATABASE_URL || "http://missing");
    return (
      (database.protocol === "postgres:" || database.protocol === "postgresql:") &&
      database.hostname === "127.0.0.1" &&
      database.port === "55432" &&
      database.pathname === "/sliper_dev"
    );
  } catch {
    return false;
  }
}

export function loadLocalTestAccount(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): LocalTestAccount | null {
  if (!isLocalTestEnvironment(env)) return null;
  try {
    const source = readFileSync(path.resolve(cwd, ".local", "test-account.json"), "utf8");
    if (source.length > 4096) return null;
    const account = accountSchema.safeParse(JSON.parse(source));
    return account.success ? account.data : null;
  } catch {
    return null;
  }
}

export function localTestAccountEnabled(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): boolean {
  return loadLocalTestAccount(env, cwd) !== null;
}

const loginSchema = z.strictObject({
  username: z.string().min(1).max(120),
  password: z.string().min(1).max(256),
});

export async function verifyTestAccountLogin(
  input: unknown,
  account: LocalTestAccount,
): Promise<boolean> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return false;
  const supplied = (await deriveKey(
    parsed.data.password,
    Buffer.from(account.passwordSalt, "base64url"),
    64,
  )) as Buffer;
  const correctPassword = timingSafeEqual(supplied, Buffer.from(account.passwordHash, "base64url"));
  return correctPassword && parsed.data.username.trim().toLowerCase() === account.username;
}

const payloadSchema = z.strictObject({
  v: z.literal(1),
  sub: z.string().uuid().nullable(),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  nonce: encodedBytes(16),
  aud: z.string().min(1).max(64),
});

function validHost(host: string): boolean {
  if (host === "localhost:3000" || host === "127.0.0.1:3000") return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):3000$/.exec(host);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  const first = octets[0];
  const second = octets[1];
  if (octets.some((octet) => octet > 255)) return false;
  return (
    first === 10 ||
    (first === 192 && second === 168) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31)
  );
}

function signPayload(payload: string, account: LocalTestAccount): string {
  return createHmac("sha256", Buffer.from(account.sessionSecret, "base64url"))
    .update(payload)
    .digest("base64url");
}

function createSession(
  account: LocalTestAccount,
  host: string,
  userId: string | null,
  nowMs: number,
): string {
  if (!validHost(host) || !Number.isFinite(nowMs) || nowMs < 0)
    throw new Error("A local test session requires a valid development host and timestamp.");
  const iat = Math.floor(nowMs / 1000);
  const value = payloadSchema.parse({
    v: 1,
    sub: userId,
    iat,
    exp: iat + LOCAL_TEST_SESSION_MAX_AGE,
    nonce: account.accountNonce,
    aud: host,
  });
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${signPayload(payload, account)}`;
}

export function createLocalTestSession(
  account: LocalTestAccount,
  host: string,
  nowMs: number = Date.now(),
): string {
  return createSession(account, host, account.userId, nowMs);
}

// A signed guest session keeps logout anonymous instead of falling back to the
// legacy loopback-only development actor. It never grants an identity.
export function createLocalTestGuestSession(
  account: LocalTestAccount,
  host: string,
  nowMs: number = Date.now(),
): string {
  return createSession(account, host, null, nowMs);
}

export function readLocalTestSession(
  token: string | null | undefined,
  account: LocalTestAccount,
  host: string,
  nowMs: number = Date.now(),
): { userId: string | null } | null {
  if (!token || token.length > 2048 || !validHost(host) || !Number.isFinite(nowMs) || nowMs < 0)
    return null;
  const parts = token.split(".");
  const [payloadText, signatureText] = parts;
  if (
    parts.length !== 2 ||
    !payloadText ||
    !signatureText ||
    !/^[A-Za-z0-9_-]+$/.test(payloadText) ||
    !canonicalBytes(signatureText, 32)
  )
    return null;
  try {
    const encoded = Buffer.from(payloadText, "base64url");
    if (encoded.toString("base64url") !== payloadText) return null;
    const signature = Buffer.from(signatureText, "base64url");
    const expected = Buffer.from(signPayload(payloadText, account), "base64url");
    if (!timingSafeEqual(signature, expected)) return null;
    const parsed = payloadSchema.safeParse(JSON.parse(encoded.toString("utf8")));
    if (!parsed.success) return null;
    const payload = parsed.data;
    const now = Math.floor(nowMs / 1000);
    if (
      payload.aud !== host ||
      payload.nonce !== account.accountNonce ||
      (payload.sub !== null && payload.sub !== account.userId) ||
      payload.iat > now ||
      payload.exp <= now ||
      payload.exp - payload.iat !== LOCAL_TEST_SESSION_MAX_AGE
    )
      return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}
