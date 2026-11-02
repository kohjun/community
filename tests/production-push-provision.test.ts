import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { test } from "node:test";
import {
  assertProductionEnvironmentSecurity,
  inspectProductionPush,
  parseRuntimeEnvironment,
  prepareProductionPush,
  ProductionPushProvisionError,
  provisionProductionPush,
} from "../scripts/lib/production-push-provision";

const origin = "https://211.188.59.204:13000";
const subject = origin;
const base = `# Managed runtime\nAPP_ORIGIN=${JSON.stringify(origin)}\nPUSH_WORKER_MODE="external"\n`;
function pair() {
  const ec = createECDH("prime256v1");
  ec.generateKeys();
  const privateKey = Buffer.alloc(32);
  const generated = ec.getPrivateKey();
  generated.copy(privateKey, 32 - generated.length);
  return {
    publicKey: ec.getPublicKey().toString("base64url"),
    privateKey: privateKey.toString("base64url"),
  };
}
function fails(code: string) {
  return (error: unknown) => error instanceof ProductionPushProvisionError && error.code === code;
}

test("production push provision preserves quoted runtime entries and rejects ambiguous syntax", () => {
  assert.deepEqual(parseRuntimeEnvironment('APP_ORIGIN="https://example.test"\nEMPTY=\n'), {
    APP_ORIGIN: "https://example.test",
    EMPTY: "",
  });
  for (const source of [
    'APP_ORIGIN="https://example.test"\nAPP_ORIGIN="https://else.test"',
    "APP_ORIGIN=https://example.test",
    'BROKEN="value" # trailing shell comment',
    'VALUE="bad\\nvalue"',
    'export APP_ORIGIN="https://example.test"',
  ]) {
    assert.throws(() => parseRuntimeEnvironment(source), fails("ENVIRONMENT_FORMAT"));
  }
});

test("VAPID creation uses one generated pair and subsequent provisioning does not rotate it", () => {
  let generated = 0;
  const generate = () => {
    generated += 1;
    return pair();
  };
  assert.deepEqual(inspectProductionPush(base, subject), {
    configured: false,
    state: "not-configured",
  });
  const created = prepareProductionPush(base, subject, generate);
  assert.equal(created.changed, true);
  const env = parseRuntimeEnvironment(created.contents);
  assert.equal(env.APP_ORIGIN, origin);
  assert.equal(env.PUSH_WORKER_MODE, "external");
  assert.equal(env.VAPID_SUBJECT, subject);
  assert.equal(created.contents.startsWith(base), true);
  assert.deepEqual(inspectProductionPush(created.contents, subject), {
    configured: true,
    state: "existing-valid",
  });
  const repeated = prepareProductionPush(created.contents, subject, generate);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.contents, created.contents);
  assert.equal(generated, 1);
});

test("empty key placeholders are filled once without duplicate keys", () => {
  const source = base + 'VAPID_SUBJECT=""\nVAPID_PUBLIC_KEY=""\nVAPID_PRIVATE_KEY=""\n';
  const created = prepareProductionPush(source, subject, pair);
  assert.equal(created.changed, true);
  const env = parseRuntimeEnvironment(created.contents);
  assert.equal(env.VAPID_SUBJECT, subject);
  assert.equal(Object.keys(env).filter((key) => key.startsWith("VAPID_")).length, 3);
});

test("partial or mismatched credentials fail without invoking key generation", () => {
  let generated = 0;
  const generate = () => {
    generated += 1;
    return pair();
  };
  const first = pair();
  const second = pair();
  const mismatched =
    base +
    `VAPID_SUBJECT=${JSON.stringify(subject)}\n` +
    `VAPID_PUBLIC_KEY=${JSON.stringify(first.publicKey)}\n` +
    `VAPID_PRIVATE_KEY=${JSON.stringify(second.privateKey)}\n`;
  for (const source of [base + `VAPID_SUBJECT=${JSON.stringify(subject)}\n`, mismatched]) {
    assert.throws(
      () => prepareProductionPush(source, subject, generate),
      fails("EXISTING_KEYS_INVALID"),
    );
  }
  assert.equal(generated, 0);
});

test("invalid generated pair is never returned for persistence", () => {
  const first = pair();
  assert.throws(
    () => prepareProductionPush(base, subject, () => ({ ...first, publicKey: "invalid" })),
    fails("GENERATED_KEYS_INVALID"),
  );
});

test("new and existing credentials require a matching public HTTPS origin", () => {
  const existing = prepareProductionPush(base, subject, pair).contents;
  for (const source of [base, existing]) {
    for (const candidate of [
      "http://211.188.59.204:13000",
      "https://localhost:13000",
      "https://example.test",
      origin + "/nested",
    ]) {
      assert.throws(
        () =>
          inspectProductionPush(
            source.replace(JSON.stringify(origin), JSON.stringify(candidate)),
            subject,
          ),
        fails("SUBJECT_ORIGIN"),
      );
    }
    assert.throws(
      () => inspectProductionPush(source, "https://else.test"),
      fails("SUBJECT_ORIGIN"),
    );
  }
});

test("root-owned group-readable environment security rejects unsafe permissions and links", () => {
  const file = { regular: true, symbolicLink: false, uid: 0, gid: 998, mode: 0o100640 };
  const directory = { directory: true, symbolicLink: false, uid: 0, gid: 998, mode: 0o40750 };
  assert.doesNotThrow(() => assertProductionEnvironmentSecurity(file, directory, "/etc/sliper"));
  for (const patch of [
    { symbolicLink: true },
    { regular: false },
    { uid: 998 },
    { gid: 0 },
    { mode: 0o100644 },
    { mode: 0o100660 },
  ]) {
    assert.throws(
      () => assertProductionEnvironmentSecurity({ ...file, ...patch }, directory, "/etc/sliper"),
      fails("FILE_SECURITY"),
    );
  }
  for (const patch of [{ symbolicLink: true }, { uid: 998 }, { gid: 999 }, { mode: 0o40770 }]) {
    assert.throws(
      () => assertProductionEnvironmentSecurity(file, { ...directory, ...patch }, "/etc/sliper"),
      fails("FILE_SECURITY"),
    );
  }
  assert.throws(
    () => assertProductionEnvironmentSecurity(file, directory, "/tmp/sliper"),
    fails("FILE_SECURITY"),
  );
});

test("provisioning an arbitrary path fails before reading or writing files", async () => {
  await assert.rejects(
    provisionProductionPush("/tmp/not-the-production-environment", subject, true, pair),
    fails("ROOT_LINUX_REQUIRED"),
  );
});
