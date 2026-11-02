import { packageNativeRelease } from "./lib/native-release-package";
const args = process.argv.slice(2);
if (args.length !== 1) throw new Error("Usage: tsx scripts/package-native-release.ts RELEASE_TAG");
try {
  console.log(JSON.stringify(await packageNativeRelease(process.cwd(), args[0]!), null, 2));
} catch {
  console.error(
    "Native source packaging failed. Inspect sources and use a new release tag; no remote action was performed.",
  );
  process.exitCode = 1;
}
