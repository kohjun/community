import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { credentialPath, secretFindings } from "../scripts/secret-policy";

test("private paths are rejected even when files are empty; example env remains shareable", () => {
  for (const file of [
    ".env",
    ".env.local",
    ".env.backup",
    "nested/.ENV.production",
    ".local/test-account.json",
    "secrets/service.json",
    "account.pem",
    "credentials.json",
    "service-account-production.json",
  ]) {
    assert.equal(credentialPath(file), true, file);
    assert.equal(secretFindings(file, "").length, 1, file);
  }
  assert.equal(credentialPath(".env.example"), false);
  assert.deepEqual(
    secretFindings(".env.example", "SUPABASE_STORAGE_SECRET_KEY=\nVAPID_PRIVATE_KEY=\n"),
    [],
  );
});

test("provider-shaped secrets are blocked in tests too, with line numbers and no matched values", () => {
  const value = `sb_secret_${randomBytes(32).toString("hex")}`;
  const findings = secretFindings(
    "tests/accidental-key.test.ts",
    `// test\nconst key = '${value}';`,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.line, 2);
  assert.equal(JSON.stringify(findings).includes(value), false);
  assert.deepEqual(
    secretFindings("tests/mock.ts", 'const key = `sb_secret_${randomBytes(32).toString("hex")}`;'),
    [],
  );
});

test("configured private values are detected without requiring a known provider format", () => {
  const value = randomBytes(32).toString("base64url");
  const findings = secretFindings("src/config.ts", `\nconst signingKey = '${value}';`, [
    { name: "VISITOR_HASH_SECRET", value },
  ]);
  assert.equal(findings[0]?.line, 2);
  assert.equal(findings[0]?.reason, "Matches configured private variable VISITOR_HASH_SECRET");
  assert.equal(JSON.stringify(findings).includes(value), false);
});

test("private JWT credentials are rejected while legacy public anon keys and mock signatures are allowed", () => {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const signature = randomBytes(32).toString("base64url");
  const token = (role: string) =>
    [header, Buffer.from(JSON.stringify({ role })).toString("base64url"), signature].join(".");
  for (const role of ["service_role", "authenticated"])
    assert.equal(secretFindings("auth.ts", token(role)).length, 1);
  assert.deepEqual(secretFindings("public.ts", token("anon")), []);
  assert.deepEqual(
    secretFindings("mock.ts", token("service_role").replace(signature, "mock-signature")),
    [],
  );
});

test("real connection passwords are caught while documented isolated and placeholder connections remain valid", () => {
  const password = randomBytes(18).toString("hex");
  assert.equal(
    secretFindings("db.ts", `postgresql://server:${password}@db.example.com/app`).length,
    1,
  );
  assert.deepEqual(
    secretFindings("test.ts", "postgresql://user:password@db.project.supabase.co/postgres"),
    [],
  );
  assert.deepEqual(
    secretFindings("test.ts", "postgresql://local:local-password@127.0.0.1:55432/sliper_dev"),
    [],
  );
});
