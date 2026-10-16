import { readFileSync } from "node:fs";
import path from "node:path";
import nextEnv from "@next/env";
import { parse } from "dotenv";
import postgres from "postgres";
import {
  auditDeploymentDatabase,
  databaseAuditFailure,
  databaseAuditTarget,
  readDatabaseAuditManifest,
  type DatabaseAuditQuery,
} from "./lib/deployment-database-audit";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const usage =
  "Usage: npm run deploy:db-check -- [--env-file .env.supabase.local] [--json] [--strict]";
let environmentFile: string | undefined;
let invalid = false;
for (let index = 0; index < args.length; index++) {
  const argument = args[index]!;
  if (argument === "--env-file") {
    const file = args[++index];
    if (environmentFile || !file || file.startsWith("--")) invalid = true;
    else environmentFile = file;
  } else if (!["--help", "--strict", "--json"].includes(argument)) invalid = true;
}
if (args.includes("--help")) {
  console.log(
    usage +
      "\nDATABASE_URL에 명시한 실행 DB에 접속하는 읽기 전용 카탈로그 점검입니다. --env-file은 해당 파일 값만 사용하며 기존 로컬 설정을 섞지 않습니다. 마이그레이션·역할 생성·데이터 변경·OAuth/Storage 요청을 실행하지 않습니다.",
  );
} else if (invalid) {
  console.error(usage);
  process.exitCode = 2;
} else {
  let environment: Record<string, string | undefined> = {};
  let loaded = false;
  try {
    if (environmentFile)
      environment = parse(readFileSync(path.resolve(process.cwd(), environmentFile)));
    else {
      nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
      environment = process.env;
    }
    loaded = true;
  } catch {
    // Do not print the requested path, file content, parse error or settings.
  }
  const target = databaseAuditTarget(environment);
  let value = databaseAuditFailure(target.scope);
  if (loaded && target.connectionString) {
    let client: ReturnType<typeof postgres> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const manifest = readDatabaseAuditManifest();
      client = postgres(target.connectionString, {
        max: 1,
        prepare: false,
        connect_timeout: 5,
        idle_timeout: 5,
        max_lifetime: 30,
        onnotice() {},
        debug: false,
        connection: {
          application_name: "sliper-readonly-deployment-audit",
          statement_timeout: 8000,
          lock_timeout: 2000,
        },
      });
      const connection = client;
      value = await Promise.race([
        connection.begin("isolation level repeatable read read only", async (transaction) => {
          await transaction`set local statement_timeout='8s'`;
          await transaction`set local lock_timeout='2s'`;
          const query: DatabaseAuditQuery = async <Row extends Record<string, unknown>>(
            text: string,
          ) => Array.from(await transaction.unsafe<Row[]>(text));
          return auditDeploymentDatabase(query, manifest, target.scope);
        }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("DB audit timeout")), 30000);
        }),
      ]);
    } catch {
      value = databaseAuditFailure(target.scope);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (client) await client.end({ timeout: 1 }).catch(() => {});
    }
  }
  if (args.includes("--json")) console.log(JSON.stringify(value, null, 2));
  else {
    console.log("Sliper 실행 DB 점검 — 읽기 전용 카탈로그 검사이며 출시 승인이 아닙니다.");
    console.log(`Scope: ${value.scope}`);
    for (const check of value.checks)
      console.log(`[${check.status.toUpperCase()}] ${check.id}: ${check.message}`);
  }
  if (args.includes("--strict") && value.checks.some((check) => check.status === "fail"))
    process.exitCode = 1;
}
