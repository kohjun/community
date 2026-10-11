import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import webpush from "web-push";
import { isLocalPushDevelopment, parsePushConfiguration } from "../src/server/push-configuration";

if (!isLocalPushDevelopment())
  throw new Error(
    "push:setup only writes keys for the isolated local development database. Production uses environment-managed VAPID keys.",
  );
const directory = path.resolve(process.cwd(), ".local");
const destination = path.join(directory, "push-vapid.json");
await mkdir(directory, { recursive: true });
const previous = await readFile(destination, "utf8").catch((error: NodeJS.ErrnoException) => {
  if (error.code === "ENOENT") return null;
  throw error;
});
if (previous) {
  if (!parsePushConfiguration(JSON.parse(previous)))
    throw new Error(
      "Existing local VAPID configuration is invalid. Restore it instead of silently rotating device keys.",
    );
  console.log("Local Web Push keys are already configured.");
} else {
  await writeFile(
    destination,
    JSON.stringify(
      { subject: "mailto:admin@localhost.invalid", ...webpush.generateVAPIDKeys() },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  console.log("Local Web Push keys configured.");
}
