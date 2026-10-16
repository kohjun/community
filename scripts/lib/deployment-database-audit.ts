import { readFileSync } from "node:fs";
import path from "node:path";
import { isIP } from "node:net";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { isPrivateRedisHost } from "../../src/server/redis-configuration";

export interface DatabaseAuditManifest {
  migrations: { hash: string; createdAt: number }[];
  tables: string[];
  functions: string[];
}
export type DatabaseAuditScope = "unconfigured" | "local-diagnostic" | "remote-database-readonly";
export interface DatabaseAuditCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  message: string;
}
export interface DatabaseAuditReport {
  checkedAt: string;
  scope: DatabaseAuditScope;
  releaseApproval: "not-performed";
  checks: DatabaseAuditCheck[];
  summary: { pass: number; warn: number; fail: number };
}
export interface DatabaseAuditQuery {
  <Row extends Record<string, unknown>>(text: string): Promise<Row[]>;
}
const messages = {
  transaction: [
    "읽기 전용 일관된 트랜잭션을 확인했습니다.",
    "읽기 전용 REPEATABLE READ 트랜잭션을 확인하지 못했습니다.",
  ],
  "runtime-role": [
    "실행 역할의 고위험 관리 권한이 없습니다.",
    "실행 역할에서 superuser·역할/DB 생성·복제 권한을 제거하세요.",
  ],
  "owner-separation": [
    "실행 역할과 앱 객체 소유자 역할이 분리되어 있습니다.",
    "실행 역할이 앱 객체 소유자이거나 소유자 역할의 구성원입니다. 별도 신뢰 서버 역할을 사용하세요.",
  ],
  "schema-access": [
    "실행 역할의 스키마 사용 권한을 확인했습니다.",
    "실행 역할에 앱 스키마 USAGE가 필요하며 스키마 CREATE 권한은 없어야 합니다.",
  ],
  "table-inventory": [
    "발행된 스키마의 모든 앱 테이블이 있습니다.",
    "앱 테이블 목록이 현재 발행 스키마와 다릅니다. 마이그레이션과 스키마 변경을 확인하세요.",
  ],
  "table-access": [
    "실행 역할의 앱 테이블 DML 권한을 확인했습니다.",
    "실행 역할에 앱 테이블 SELECT·INSERT·UPDATE·DELETE 권한이 필요합니다.",
  ],
  "row-security": [
    "모든 앱 테이블의 RLS와 신뢰 서버 역할의 실효 접근을 확인했습니다.",
    "모든 앱 테이블의 RLS를 켜고 현재 서버 인가 방식에 맞는 비소유자 신뢰 서버 역할의 RLS 우회 접근을 준비하세요.",
  ],
  "function-access": [
    "앱 함수 목록과 실행 역할의 EXECUTE 권한을 확인했습니다.",
    "발행된 앱 함수가 없거나 실행 역할의 EXECUTE 권한이 부족합니다.",
  ],
  "browser-isolation": [
    "PUBLIC·비회원·로그인 브라우저 역할의 앱 스키마·테이블·민감 함수 접근이 차단되어 있습니다.",
    "PUBLIC·anon·authenticated의 앱 스키마 USAGE/CREATE·테이블/열 DML·민감 함수 EXECUTE 권한을 회수하세요.",
  ],
  migrations: [
    "전체 마이그레이션의 순서·시각·파일 해시가 DB 원장과 일치합니다.",
    "전체 마이그레이션 원장을 읽을 수 없거나 순서·시각·파일 해시가 다릅니다. 비밀키를 바꾸거나 소유자 연결로 우회하지 말고 적용 결과와 점검용 원장 SELECT 권한을 확인하세요.",
  ],
} as const;
function report(scope: DatabaseAuditScope, checks: DatabaseAuditCheck[]): DatabaseAuditReport {
  const summary = { pass: 0, warn: 0, fail: 0 };
  for (const check of checks) summary[check.status]++;
  return {
    checkedAt: new Date().toISOString(),
    scope,
    releaseApproval: "not-performed",
    checks,
    summary,
  };
}
export function databaseAuditFailure(scope: DatabaseAuditScope): DatabaseAuditReport {
  return report(scope, [
    {
      id: "database-connection",
      status: "fail",
      message:
        "DB 읽기 전용 점검을 완료하지 못했습니다. 연결·타임아웃·점검 권한을 대상 환경에서 확인하세요. 원문 오류와 접속 설정은 표시하지 않습니다.",
    },
  ]);
}
/** Only configuration validation. The connection string is never part of a report. */
export function databaseAuditTarget(env: Record<string, string | undefined>) {
  try {
    const value = env.DATABASE_URL ?? "";
    if (value !== value.trim() || /[\u0000-\u0020\u007f]/.test(value)) throw new Error();
    const address = new URL(value);
    if (
      !["postgres:", "postgresql:"].includes(address.protocol) ||
      !address.username ||
      !address.password ||
      address.pathname.length < 2 ||
      address.hash
    )
      throw new Error();
    decodeURIComponent(address.username);
    decodeURIComponent(address.password);
    const host = address.hostname.toLowerCase();
    const rawHost = host.replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (
      !isIP(rawHost) &&
      (rawHost.length > 253 ||
        /^\d+(?:\.\d+){3}$/.test(rawHost) ||
        !rawHost.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)))
    )
      throw new Error();
    const local = isPrivateRedisHost(host);
    const scope: DatabaseAuditScope = local ? "local-diagnostic" : "remote-database-readonly";
    if (
      !local &&
      !["require", "verify-full", "verify-ca"].includes(address.searchParams.get("sslmode") ?? "")
    )
      return { scope, connectionString: null };
    return { scope, connectionString: value };
  } catch {
    return { scope: "unconfigured" as const, connectionString: null };
  }
}
/** Derive the deployment contract from the checked-in migration journal and its latest snapshot. */
export function readDatabaseAuditManifest(workspace = process.cwd()): DatabaseAuditManifest {
  try {
    const folder = path.join(workspace, "drizzle");
    const journal = JSON.parse(
      readFileSync(path.join(folder, "meta", "_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string; when: number }[] };
    const entries = journal.entries;
    if (
      !entries.length ||
      entries.some(
        (entry, index) =>
          entry.idx !== index ||
          !new RegExp(`^${String(index).padStart(4, "0")}_[a-z0-9_]+$`).test(entry.tag) ||
          !Number.isSafeInteger(entry.when) ||
          (index > 0 && entry.when <= entries[index - 1]!.when),
      )
    )
      throw new Error();
    const migrations = readMigrationFiles({ migrationsFolder: folder });
    if (migrations.length !== entries.length) throw new Error();
    const snapshot = JSON.parse(
      readFileSync(
        path.join(folder, "meta", `${String(entries.at(-1)!.idx).padStart(4, "0")}_snapshot.json`),
        "utf8",
      ),
    ) as { tables: Record<string, { schema: string; name: string }> };
    const tables = Object.values(snapshot.tables)
      .filter((table) => table.schema === "sliper")
      .map((table) => table.name)
      .sort();
    const functions = new Set<string>();
    for (const migration of migrations)
      for (const statement of migration.sql) {
        // Current migrations only create/replace app functions. Fail closed if the contract later introduces removals.
        if (/\bDROP\s+FUNCTION\b/i.test(statement)) throw new Error();
        for (const match of statement.matchAll(
          /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"sliper"|sliper)\s*\.\s*(?:"([a-z_][a-z\d_]*)"|([a-z_][a-z\d_]*))\s*\(/gi,
        ))
          functions.add(match[1] ?? match[2]!);
      }
    if (
      !tables.length ||
      !functions.size ||
      new Set(tables).size !== tables.length ||
      tables.some((name) => !/^[a-z_][a-z\d_]*$/.test(name))
    )
      throw new Error();
    return {
      migrations: migrations.map((migration) => ({
        hash: migration.hash,
        createdAt: migration.folderMillis,
      })),
      tables,
      functions: [...functions].sort(),
    };
  } catch {
    throw new Error(
      "발행된 DB 마이그레이션 계약을 읽지 못했습니다. 저장소의 journal·snapshot·SQL 파일을 확인하세요.",
    );
  }
}
export const databaseAuditSql = {
  transport:
    "select coalesce((select ssl from pg_stat_ssl where pid=pg_backend_pid()),false) as encrypted",
  transaction:
    "select current_setting('transaction_read_only')='on' as readonly, current_setting('transaction_isolation')='repeatable read' as repeatable",
  role: "select rolsuper as superuser, rolcreatedb as create_db, rolcreaterole as create_role, rolreplication as replication, rolbypassrls as bypass_rls, exists(select 1 from pg_roles inherited where pg_has_role(current_user,inherited.oid,'MEMBER') and (inherited.rolsuper or inherited.rolcreatedb or inherited.rolcreaterole or inherited.rolreplication)) as elevated_membership from pg_roles where rolname=current_user",
  schema:
    "select pg_has_role(current_user,n.nspowner,'MEMBER') as owner_member, has_schema_privilege(current_user,n.oid,'USAGE') as usage, has_schema_privilege(current_user,n.oid,'CREATE') as create_privilege from pg_namespace n where n.nspname='sliper'",
  tables: `select c.relname as name, c.relrowsecurity as rls, row_security_active(c.oid) as rls_active, pg_has_role(current_user,c.relowner,'MEMBER') as owner_member,
    has_table_privilege(current_user,c.oid,'SELECT') as can_select, has_table_privilege(current_user,c.oid,'INSERT') as can_insert,
    has_table_privilege(current_user,c.oid,'UPDATE') as can_update, has_table_privilege(current_user,c.oid,'DELETE') as can_delete
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='sliper' and c.relkind in ('r','p') order by c.relname`,
  functions:
    "select p.proname as name, pg_has_role(current_user,p.proowner,'MEMBER') as owner_member, has_function_privilege(current_user,p.oid,'EXECUTE') as executable from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sliper' order by p.proname,p.oid",
  browser: `select
    (select count(*)::int from pg_roles where rolname in ('anon','authenticated')) as roles,
    exists(select 1 from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl where n.nspname='sliper' and acl.grantee=0 and acl.privilege_type in ('USAGE','CREATE')) as public_schema,
    exists(select 1 from pg_namespace n cross join pg_roles r where n.nspname='sliper' and r.rolname in ('anon','authenticated') and has_schema_privilege(r.oid,n.oid,'USAGE,CREATE')) as browser_schema,
    exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl where n.nspname='sliper' and c.relkind in ('r','p','v','m','f') and acl.grantee=0 and acl.privilege_type in ('SELECT','INSERT','UPDATE','DELETE')) as public_tables,
    exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join pg_roles r where n.nspname='sliper' and c.relkind in ('r','p','v','m','f') and r.rolname in ('anon','authenticated') and (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE'))) as browser_tables,
    exists(select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(a.attacl) acl where n.nspname='sliper' and a.attnum>0 and not a.attisdropped and acl.grantee=0 and acl.privilege_type in ('SELECT','INSERT','UPDATE')) as public_columns,
    exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where n.nspname='sliper' and acl.grantee=0 and acl.privilege_type='EXECUTE') as public_functions,
    exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join pg_roles r where n.nspname='sliper' and r.rolname in ('anon','authenticated') and has_function_privilege(r.oid,p.oid,'EXECUTE')) as browser_functions`,
  exposedFunctions: `select p.proname as name, pg_get_function_identity_arguments(p.oid) as arguments, p.prosecdef as security_definer, p.provolatile as volatility, l.lanname as language, p.prosrc as source, p.proconfig as configuration, p.prorettype='pg_catalog.trigger'::regtype as returns_trigger
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
    where n.nspname='sliper' and (exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE')
      or exists(select 1 from pg_roles r where r.rolname in ('anon','authenticated') and has_function_privilege(r.oid,p.oid,'EXECUTE')))`,
  migrations:
    "select hash, created_at::text as created_at from drizzle.__drizzle_migrations order by created_at,id",
} as const;
/** Must run inside a bounded READ ONLY REPEATABLE READ transaction. No application rows are read. */
export async function auditDeploymentDatabase(
  query: DatabaseAuditQuery,
  manifest: DatabaseAuditManifest,
  scope: DatabaseAuditScope,
): Promise<DatabaseAuditReport> {
  const checks: DatabaseAuditCheck[] = [];
  const add = (id: keyof typeof messages, pass: boolean) =>
    checks.push({ id, status: pass ? "pass" : "fail", message: messages[id][pass ? 0 : 1] });
  checks.push({
    id: "target-environment",
    status: scope === "remote-database-readonly" ? "pass" : "warn",
    message:
      scope === "remote-database-readonly"
        ? "명시한 원격 실행 DB의 카탈로그만 확인합니다. OAuth·Storage·실제 서비스 동작은 검증하지 않습니다."
        : "로컬/내부 DB 진단입니다. 결과가 통과해도 Supabase 운영 검증이나 출시 완료로 계산하지 않습니다.",
  });
  const [transaction] = await query<{ readonly: boolean; repeatable: boolean }>(
    databaseAuditSql.transaction,
  );
  const safe = transaction?.readonly === true && transaction.repeatable === true;
  add("transaction", safe);
  if (!safe) return report(scope, checks);
  const [transport] = await query<{ encrypted: boolean }>(databaseAuditSql.transport);
  checks.push({
    id: "transport-security",
    status: transport?.encrypted === true ? "pass" : scope === "local-diagnostic" ? "warn" : "fail",
    message:
      transport?.encrypted === true
        ? "현재 DB 백엔드 세션의 TLS 암호화를 확인했습니다. 프록시·pooler 앞 구간과 서비스 전체 보안 검증은 별도입니다."
        : scope === "local-diagnostic"
          ? "현재 로컬/내부 DB 세션의 TLS를 확인하지 못했습니다. 운영 TLS 검증 완료로 계산하지 않습니다."
          : "현재 DB 백엔드 세션의 TLS 암호화를 확인하지 못했습니다. 원격 실행 연결과 pooler의 TLS를 확인하세요.",
  });
  const [role] = await query<{
    superuser: boolean;
    create_db: boolean;
    create_role: boolean;
    replication: boolean;
    bypass_rls: boolean;
    elevated_membership: boolean;
  }>(databaseAuditSql.role);
  const [schema] = await query<{
    owner_member: boolean;
    usage: boolean;
    create_privilege: boolean;
  }>(databaseAuditSql.schema);
  const tables = await query<{
    name: string;
    rls: boolean;
    rls_active: boolean;
    owner_member: boolean;
    can_select: boolean;
    can_insert: boolean;
    can_update: boolean;
    can_delete: boolean;
  }>(databaseAuditSql.tables);
  const functions = await query<{ name: string; owner_member: boolean; executable: boolean }>(
    databaseAuditSql.functions,
  );
  const [browser] = await query<{
    roles: number;
    public_schema: boolean;
    browser_schema: boolean;
    public_tables: boolean;
    browser_tables: boolean;
    public_columns: boolean;
    public_functions: boolean;
    browser_functions: boolean;
  }>(databaseAuditSql.browser);
  const exposedFunctions = await query<{
    name: string;
    arguments: string;
    security_definer: boolean;
    volatility: string;
    language: string;
    source: string;
    configuration: string[] | null;
    returns_trigger: boolean;
  }>(databaseAuditSql.exposedFunctions);
  const safePureHelper = (row: (typeof exposedFunctions)[number]) =>
    row.name === "search_tags" &&
    row.arguments === "value text[]" &&
    !row.security_definer &&
    row.volatility === "i" &&
    row.language === "sql" &&
    row.source.trim() === "SELECT pg_catalog.array_to_string(value, ' ')" &&
    JSON.stringify(row.configuration) === JSON.stringify(['search_path=""']);
  const safeExposedHelper = (entry: (typeof exposedFunctions)[number]) =>
    safePureHelper(entry) || (!entry.security_definer && entry.returns_trigger);
  add(
    "runtime-role",
    !!role &&
      !role.superuser &&
      !role.create_db &&
      !role.create_role &&
      !role.replication &&
      !role.elevated_membership,
  );
  add(
    "owner-separation",
    !!schema &&
      !schema.owner_member &&
      tables.length > 0 &&
      functions.length > 0 &&
      tables.every((row) => !row.owner_member) &&
      functions.every((row) => !row.owner_member),
  );
  add("schema-access", !!schema && schema.usage && !schema.create_privilege);
  add(
    "table-inventory",
    JSON.stringify(tables.map((row) => row.name).sort()) ===
      JSON.stringify([...manifest.tables].sort()),
  );
  add(
    "table-access",
    tables.length > 0 &&
      tables.every((row) => row.can_select && row.can_insert && row.can_update && row.can_delete),
  );
  add(
    "row-security",
    !!role?.bypass_rls && tables.length > 0 && tables.every((row) => row.rls && !row.rls_active),
  );
  const functionNames = new Set(functions.map((row) => row.name));
  add(
    "function-access",
    functions.length > 0 &&
      manifest.functions.every((name) => functionNames.has(name)) &&
      functions.every((row) => row.executable),
  );
  add(
    "browser-isolation",
    !!browser &&
      browser.roles === 2 &&
      !browser.public_schema &&
      !browser.browser_schema &&
      !browser.public_tables &&
      !browser.browser_tables &&
      !browser.public_columns &&
      exposedFunctions.every(safeExposedHelper),
  );
  if (exposedFunctions.length > 0 && exposedFunctions.every(safeExposedHelper))
    checks.push({
      id: "pure-helper-policy",
      status: "warn",
      message:
        "공개 EXECUTE는 검증한 순수 검색 보조 함수 또는 일반 SQL에서 직접 호출할 수 없는 SECURITY INVOKER 트리거 함수에만 있습니다. 스키마·테이블 접근은 별도 차단하며 기본 함수 권한 회수 정책과 차이를 검토하세요.",
    });
  // Isolate a missing/forbidden migration journal so the read-only transaction can still end cleanly.
  await query("savepoint sliper_migration_audit");
  try {
    const rows = await query<{ hash: string; created_at: string }>(databaseAuditSql.migrations);
    await query("release savepoint sliper_migration_audit");
    add(
      "migrations",
      rows.length === manifest.migrations.length &&
        rows.every(
          (row, index) =>
            row.hash === manifest.migrations[index]!.hash &&
            row.created_at === String(manifest.migrations[index]!.createdAt),
        ),
    );
  } catch {
    await query("rollback to savepoint sliper_migration_audit");
    await query("release savepoint sliper_migration_audit");
    add("migrations", false);
  }
  return report(scope, checks);
}
