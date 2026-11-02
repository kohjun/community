import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CloudCaptureError,
  execute,
  fail,
  openServerRecovery,
  sealServerRecovery,
} from "./lib/cloud-capture";
import {
  containedPath,
  initializeBackup,
  newBackupId,
  verifyPrivate,
} from "./lib/local-backup-core";
const roots = [
  "etc/sliper/runtime.env",
  "etc/sliper-tls/Caddyfile",
  "etc/sliper-tls/runtime.env",
  "etc/sliper-tls/nginx-ip-acme.conf",
  "var/lib/sliper-tls/certificates",
  "etc/systemd/system/sliper-web.service",
  "etc/systemd/system/sliper-web.service.d/https-backend.conf",
  "etc/systemd/system/sliper-tls.service",
  "etc/systemd/system/sliper-notifications.service",
  "etc/systemd/system/sliper-video.service",
  "etc/systemd/system/sliper-monitor.service",
  "etc/systemd/system/sliper-monitor-probe.service",
  "etc/systemd/system/sliper-monitor.timer",
  "opt/sliper/ops/sliper-monitor.py",
];
try {
  const args = process.argv.slice(2);
  if (
    args.length !== 6 ||
    args[0] !== "--host" ||
    args[2] !== "--key" ||
    args[4] !== "--known-hosts"
  )
    fail("USAGE_HOST_KEY_KNOWN_HOSTS");
  const host = args[1]!;
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.split(".").some((n) => Number(n) > 255))
    fail("SSH_HOST");
  const command =
    "set -eu\nbefore=$(sha256sum /etc/sliper/runtime.env /etc/sliper-tls/Caddyfile)\ntar -czf - -C / -- " +
    roots.join(" ") +
    '\nafter=$(sha256sum /etc/sliper/runtime.env /etc/sliper-tls/Caddyfile)\ntest "$before" = "$after"';
  const ssh = process.platform === "win32" ? "C:/Windows/System32/OpenSSH/ssh.exe" : "/usr/bin/ssh";
  const fetched = await execute(
    ssh,
    [
      "-T",
      "-i",
      path.resolve(args[3]!),
      "-p",
      "22",
      "-o",
      "BatchMode=yes",
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "UserKnownHostsFile=" + path.resolve(args[5]!),
      "-o",
      "ConnectTimeout=8",
      "root@" + host,
      command,
    ],
    { windowsHide: true, encoding: "buffer", timeout: 60000, maxBuffer: 4 * 1024 ** 2 },
  );
  const original = Buffer.from(fetched.stdout),
    id = newBackupId(),
    { root, key } = await initializeBackup(process.cwd(), id),
    sealed = sealServerRecovery(original, key, id);
  const dataPath = containedPath(root, "server-recovery.enc"),
    metadataPath = containedPath(root, "server-recovery.json");
  await writeFile(dataPath, sealed.bytes, { flag: "wx", mode: 0o600 });
  await writeFile(metadataPath, JSON.stringify(sealed.envelope, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  await verifyPrivate(dataPath);
  await verifyPrivate(metadataPath);
  const decrypted = openServerRecovery(
    await readFile(dataPath),
    JSON.parse(await readFile(metadataPath, "utf8")),
    key,
    id,
  );
  if (
    createHash("sha256").update(decrypted).digest("hex") !==
    createHash("sha256").update(original).digest("hex")
  )
    fail("RECOVERY_HASH");
  // Inspect TAR members in memory without ever extracting private configuration to disk.
  const code =
    "import sys,io,tarfile,json,pathlib\ndata=sys.stdin.buffer.read(4194305)\nassert len(data)<=4194304\nroots=" +
    JSON.stringify(roots) +
    "\nwith tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as t:\n members=t.getmembers()\n assert 1<=len(members)<=500\n for m in members:\n  p=pathlib.PurePosixPath(m.name)\n  assert not p.is_absolute() and '..' not in p.parts and '\\\\' not in m.name\n  assert m.isfile() or m.isdir()\n  assert any(m.name.rstrip('/')==r or m.name.startswith(r+'/') for r in roots)\n  assert m.size<=1048576\n print(json.dumps({'archiveMembers':len(members),'safePaths':True}))";
  const python = spawn(process.platform === "win32" ? "python" : "python3", ["-B", "-c", code], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const chunks: Buffer[] = [];
  python.stdout.on("data", (c) => chunks.push(Buffer.from(c)));
  python.stderr.resume();
  const completed = new Promise<void>((resolve, reject) => {
    python.once("error", () => reject(new CloudCaptureError("ARCHIVE_INSPECTION")));
    python.once("exit", (c) =>
      c === 0 ? resolve() : reject(new CloudCaptureError("ARCHIVE_INSPECTION")),
    );
  });
  python.stdin.end(decrypted);
  await completed;
  const inspected = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const report = {
    status: "SERVER_RECOVERY_ENCRYPTED_CAPTURE_VERIFIED",
    backup: id,
    encrypted: true,
    archiveBytes: original.length,
    archiveMembers: inspected.archiveMembers,
    safeArchivePaths: true,
    decryptionAndHashVerified: true,
    plaintextWrittenToDisk: false,
    privateKeysDisplayed: false,
    sourceFilesChanged: false,
    restoreToServerPerformed: false,
  };
  original.fill(0);
  decrypted.fill(0);
  await writeFile(".local/server-recovery-latest.json", JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
  });
  console.log(JSON.stringify(report));
} catch (error) {
  console.error(
    JSON.stringify({
      status: "SERVER_RECOVERY_CAPTURE_FAILED",
      code: error instanceof CloudCaptureError ? error.code : "CAPTURE_FAILURE",
      privateValuesDisplayed: false,
    }),
  );
  process.exitCode = 1;
}
