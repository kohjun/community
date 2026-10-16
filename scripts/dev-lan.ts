import nextEnv from "@next/env";
import { networkInterfaces } from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import { assertLocalLanDevelopment, developmentLanAddress } from "./lib/development-lan";

try {
  Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? "development" });
  nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
  assertLocalLanDevelopment(process.env);
  const host = developmentLanAddress(networkInterfaces(), process.env.SLIPER_LAN_HOST);
  console.log(`PC: http://127.0.0.1:3000/\n같은 와이파이의 휴대폰: http://${host}:3000/`);
  console.log("휴대폰은 로그인 후 글쓰기와 계정 설정을 이용할 수 있어요.");
  const child = spawn(
    process.execPath,
    [
      path.resolve("node_modules/next/dist/bin/next"),
      "dev",
      "--hostname",
      "0.0.0.0",
      "--port",
      "3000",
    ],
    {
      stdio: "inherit",
      env: { ...process.env, SLIPER_LAN_HOST: host },
    },
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => child.kill(signal));
  child.once("error", () => {
    console.error("개발 서버를 시작하지 못했어요.");
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    process.exitCode = code ?? 0;
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : "와이파이 개발 환경을 확인해주세요.");
  process.exitCode = 1;
}
