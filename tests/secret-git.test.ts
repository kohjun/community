import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(process.cwd());
const checker = path.join(projectRoot, "scripts", "check-secrets.ts");
const testParent = path.join(projectRoot, ".local", "secret-git-tests");
assert.equal(existsSync(checker), true, "Run the isolated Git tests from the project root.");

function isolatedRepository(run: (repo: string, environment: NodeJS.ProcessEnv) => void) {
  mkdirSync(testParent, { recursive: true });
  const parent = realpathSync(testParent);
  const repo = path.join(parent, randomUUID());
  mkdirSync(repo);
  // An inherited index/worktree can point at the original, moved checkout. Never reuse it.
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/^GIT_/i.test(key)) delete environment[key];
  }
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
  environment.GIT_TERMINAL_PROMPT = "0";
  try {
    git(repo, environment, "init", "--quiet");
    run(repo, environment);
  } finally {
    const absolute = path.resolve(repo);
    assert.equal(
      path.dirname(absolute),
      parent,
      "Cleanup must stay within the isolated test directory.",
    );
    assert.equal(
      lstatSync(absolute).isSymbolicLink(),
      false,
      "Do not follow a replaced test directory.",
    );
    assert.equal(
      realpathSync(absolute),
      absolute,
      "Cleanup target must remain the original test directory.",
    );
    rmSync(absolute, { recursive: true, force: true });
  }
}

function git(repo: string, environment: NodeJS.ProcessEnv, ...args: string[]) {
  const result = spawnSync(
    "git",
    [`--git-dir=${path.join(repo, ".git")}`, `--work-tree=${repo}`, ...args],
    { cwd: repo, env: environment, encoding: "utf8", timeout: 15000, windowsHide: true },
  );
  // Fail closed. Do not surface arbitrary Git output containing a test credential.
  assert.equal(
    result.error === undefined,
    true,
    "Git is required for the staged-blob security test.",
  );
  assert.equal(result.status, 0, "The isolated Git operation must succeed.");
  return result.stdout;
}

function check(repo: string, environment: NodeJS.ProcessEnv, staged: boolean) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", checker, ...(staged ? ["--staged"] : [])],
    { cwd: repo, env: environment, encoding: "utf8", timeout: 30000, windowsHide: true },
  );
  assert.equal(result.error === undefined, true, "The isolated secret checker must launch.");
  assert.equal(result.signal, null, "The isolated secret checker must finish normally.");
  return result;
}

function assertRedacted(result: SpawnSyncReturns<string>, credential: string) {
  assert.equal(
    result.stdout.includes(credential),
    false,
    "stdout must not print credential values.",
  );
  assert.equal(
    result.stderr.includes(credential),
    false,
    "stderr must not print credential values.",
  );
}

test("staged private tokens remain blocked after the current worktree is cleaned", () => {
  isolatedRepository((repo, environment) => {
    const credential = `sb_secret_${randomBytes(32).toString("hex")}`;
    const file = path.join(repo, "accidental.ts");
    writeFileSync(file, `export const privateToken = '${credential}';\n`);
    git(repo, environment, "add", "--", "accidental.ts");
    writeFileSync(file, "export const privateToken = process.env.PRIVATE_TOKEN;\n");
    assert.equal(git(repo, environment, "show", ":accidental.ts").includes(credential), true);

    const worktree = check(repo, environment, false);
    assertRedacted(worktree, credential);
    assert.equal(worktree.status, 0, "The sanitized working file should pass the normal scan.");
    const staged = check(repo, environment, true);
    assertRedacted(staged, credential);
    assert.equal(staged.status, 1, "The staged blob must still be rejected.");
    assert.equal(staged.stderr.includes("accidental.ts:1"), true);
    assert.equal(staged.stderr.includes("Supabase server secret"), true);
  });
});

test("forced staging of an ignored empty .env file is rejected by filename alone", () => {
  isolatedRepository((repo, environment) => {
    writeFileSync(path.join(repo, ".gitignore"), ".env\n");
    writeFileSync(path.join(repo, ".env"), "");
    assert.equal(git(repo, environment, "check-ignore", "--", ".env").trim(), ".env");
    git(repo, environment, "add", "--force", "--", ".env");
    const staged = check(repo, environment, true);
    assert.equal(staged.status, 1);
    assert.equal(staged.stderr.includes(".env:1"), true);
    assert.equal(
      staged.stderr.includes("Private environment or credential file must not be committed"),
      true,
    );
  });
});

test("a staged .env.example containing only blank private-variable placeholders passes", () => {
  isolatedRepository((repo, environment) => {
    writeFileSync(path.join(repo, ".gitignore"), ".env\n.env.*\n!.env.example\n");
    writeFileSync(
      path.join(repo, ".env.example"),
      "SUPABASE_STORAGE_SECRET_KEY=\nVAPID_PRIVATE_KEY=\nDATABASE_URL=\n",
    );
    git(repo, environment, "add", "--", ".env.example");
    const staged = check(repo, environment, true);
    assert.equal(staged.status, 0);
    assert.equal(staged.stderr, "");
    assert.equal(staged.stdout.includes("1 staged files; values redacted"), true);
  });
});

test("an isolated repository with no staged files passes without reading untracked values", () => {
  isolatedRepository((repo, environment) => {
    const credential = `sb_secret_${randomBytes(32).toString("hex")}`;
    writeFileSync(path.join(repo, "not-staged.ts"), `const secret = '${credential}';\n`);
    const staged = check(repo, environment, true);
    assertRedacted(staged, credential);
    assert.equal(staged.status, 0);
    assert.equal(staged.stdout.includes("0 staged files; values redacted"), true);
  });
});
