import nextEnv from "@next/env";
import { deploymentReadiness } from "../src/server/deployment-readiness";
// Match Next production env precedence without displaying loader errors or values.
nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const args = process.argv.slice(2);
if (args.some((arg) => !["--strict", "--json"].includes(arg))) {
  console.error("Usage: npm run deploy:check -- [--strict] [--json]");
  process.exitCode = 2;
} else {
  const checks = deploymentReadiness(process.env);
  if (args.includes("--json"))
    console.log(JSON.stringify({ scope: "configuration-only", checks }, null, 2));
  else {
    console.log("Sliper 운영 설정 점검 — 외부 연결 없이 설정 형식만 검사합니다.");
    for (const check of checks)
      console.log(`[${check.status.toUpperCase()}] ${check.id}: ${check.message}`);
  }
  if (args.includes("--strict") && checks.some((check) => check.status === "fail"))
    process.exitCode = 1;
}
