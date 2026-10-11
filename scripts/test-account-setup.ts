import "dotenv/config";
import { randomBytes, randomUUID, scrypt } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import {
  isLocalTestEnvironment,
  loadLocalTestAccount,
  type LocalTestAccount,
} from "../src/server/local-test-auth";

// CLI scripts do not receive Next.js's development NODE_ENV automatically.
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || "development",
};
if (!isLocalTestEnvironment(environment))
  throw new Error(
    "Test accounts are restricted to the isolated local Sliper development database.",
  );
const directory = path.resolve(process.cwd(), ".local");
const destination = path.join(directory, "test-account.json");
await mkdir(directory, { recursive: true });
const previous = await readFile(destination, "utf8").catch((error: NodeJS.ErrnoException) => {
  if (error.code === "ENOENT") return null;
  throw error;
});
let account = loadLocalTestAccount(environment);
if (previous !== null && !account)
  throw new Error(
    "The existing test-account file is invalid. Restore it instead of silently changing login credentials.",
  );
let password: string | null = null;
if (!account) {
  password = `Sliper!${randomBytes(18).toString("base64url")}`;
  const salt = randomBytes(32);
  const hash = (await promisify(scrypt)(password, salt, 64)) as Buffer;
  account = {
    version: 1,
    username: "test@sliper.local",
    userId: randomUUID(),
    passwordSalt: salt.toString("base64url"),
    passwordHash: hash.toString("base64url"),
    sessionSecret: randomBytes(32).toString("base64url"),
    accountNonce: randomBytes(16).toString("base64url"),
  } satisfies LocalTestAccount;
}
const database = postgres(environment.DATABASE_URL!, { max: 1, prepare: false });
try {
  await database.begin(async (transaction) => {
    await transaction`insert into auth.users (id) values (${account.userId}) on conflict (id) do nothing`;
    await transaction`insert into sliper.profiles (id, nickname, analytics_excluded) values (${account.userId}, '테스트플레이어', true) on conflict (id) do update set analytics_excluded=true`;
    if (password !== null)
      await writeFile(destination, JSON.stringify(account, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
  });
} finally {
  await database.end();
}
if (password !== null) {
  // Print this newly generated test credential once for the user's requested
  // handoff. The plaintext password is never written to a file or database.
  console.log(`Test account created.\nUsername: ${account.username}\nPassword: ${password}`);
} else {
  console.log(
    `Test account already exists: ${account.username}. Its password is not recoverable or automatically reset.`,
  );
}
