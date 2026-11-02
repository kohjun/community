/** Read-only readiness only: this module never creates a dump, changes a DB, or moves objects. */
export type BackupEnvironment = Record<string, string | undefined>;
export class CloudBackupConfigurationError extends Error {
  constructor() {
    super("CLOUD_BACKUP_CONFIGURATION_INVALID");
  }
}
export function supabaseProjectReference(value: string | undefined): string {
  try {
    const url = new URL(value ?? "");
    const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
    if (
      !match ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error();
    return match[1]!;
  } catch {
    throw new CloudBackupConfigurationError();
  }
}
function databaseTarget(value: string | undefined, reference: string, dump: boolean): string {
  try {
    if (!value || value !== value.trim() || /[\u0000-\u0020\u007f]/.test(value)) throw new Error();
    const url = new URL(value),
      user = decodeURIComponent(url.username);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !user ||
      !url.password ||
      url.pathname !== "/postgres" ||
      url.hash ||
      !["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode") ?? "")
    )
      throw new Error();
    if (
      [...url.searchParams.keys()].some(
        (key) => key !== "sslmode" && (dump || key !== "max_pipeline"),
      ) ||
      url.searchParams.getAll("sslmode").length !== 1
    )
      throw new Error();
    if (
      url.searchParams.has("max_pipeline") &&
      (url.searchParams.getAll("max_pipeline").length !== 1 ||
        !/^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-6])$/.test(
          url.searchParams.get("max_pipeline")!,
        ))
    )
      throw new Error();
    const direct =
      url.hostname === `db.${reference}.supabase.co` && (!url.port || url.port === "5432");
    const pooler =
      /^aws-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
      user.endsWith("." + reference) &&
      ["5432", ...(!dump ? ["6543"] : [])].includes(url.port);
    if (!direct && !pooler) throw new Error();
    decodeURIComponent(url.password);
    return value;
  } catch {
    throw new CloudBackupConfigurationError();
  }
}
export function cloudBackupConfiguration(env: BackupEnvironment) {
  const reference = supabaseProjectReference(env.NEXT_PUBLIC_SUPABASE_URL);
  if (
    supabaseProjectReference(env.SUPABASE_STORAGE_URL) !== reference ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(env.SUPABASE_STORAGE_BUCKET ?? "") ||
    !env.SUPABASE_STORAGE_SECRET_KEY ||
    /\s/.test(env.SUPABASE_STORAGE_SECRET_KEY)
  )
    throw new CloudBackupConfigurationError();
  const source = databaseTarget(env.DATABASE_URL, reference, false);
  const dump = env.BACKUP_DATABASE_URL
    ? databaseTarget(env.BACKUP_DATABASE_URL, reference, true)
    : null;
  const hasRestore = !!(env.BACKUP_RESTORE_PROJECT_URL || env.BACKUP_RESTORE_DATABASE_URL);
  let restore: string | null = null;
  if (hasRestore) {
    const restoreReference = supabaseProjectReference(env.BACKUP_RESTORE_PROJECT_URL);
    if (restoreReference === reference) throw new CloudBackupConfigurationError();
    restore = databaseTarget(env.BACKUP_RESTORE_DATABASE_URL, restoreReference, true);
  }
  return {
    source,
    dump,
    restore,
    storageUrl: env.SUPABASE_STORAGE_URL!,
    bucket: env.SUPABASE_STORAGE_BUCKET!,
    storageKey: env.SUPABASE_STORAGE_SECRET_KEY,
  };
}
export type BackupQuery = (text: string) => Promise<Record<string, unknown>[]>;
const safeCount = (value: unknown) => {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("BACKUP_INVENTORY_FAILED");
  return count;
};
export async function sourceBackupInventory(query: BackupQuery) {
  const [metadata] = await query(
    "select current_setting('server_version_num') as version,current_setting('transaction_read_only') as readonly,current_setting('transaction_isolation') as isolation,(select count(*)::text from drizzle.__drizzle_migrations) as migrations,(select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='sliper' and c.relkind in ('r','p')) as tables,exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' and c.relname='users' and c.relkind='r') as auth_present,exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='drizzle' and c.relname='__drizzle_migrations' and c.relkind='r') as migrations_present",
  );
  if (
    !metadata ||
    metadata.readonly !== "on" ||
    metadata.isolation !== "repeatable read" ||
    metadata.auth_present !== true ||
    metadata.migrations_present !== true
  )
    throw new Error("BACKUP_INVENTORY_FAILED");
  const rows = await query(
    "select 'images' as kind,count(*)::text as files,coalesce(sum(byte_size),0)::text as bytes,count(*) filter(where storage_backend<>'supabase')::text as local from sliper.media_assets where status='ready' union all select 'profiles',count(*)::text,coalesce(sum(bytes),0)::text,count(*) filter(where storage_backend<>'supabase')::text from sliper.profile_photos union all select 'videos',count(*)::text,coalesce(sum(byte_size),0)::text,count(*) filter(where storage_backend<>'supabase')::text from sliper.video_assets where status='ready' union all select 'video-sources',count(*)::text,coalesce(sum(source_byte_size),0)::text,count(*) filter(where source_storage_backend<>'supabase')::text from sliper.video_processing_jobs where source_ready and source_removed_at is null",
  );
  const kinds = ["images", "profiles", "videos", "video-sources"];
  if (
    rows.length !== kinds.length ||
    new Set(rows.map((row) => row.kind)).size !== kinds.length ||
    rows.some((row) => !kinds.includes(String(row.kind)))
  )
    throw new Error("BACKUP_INVENTORY_FAILED");
  const objects = rows.map((row) => ({
    kind: String(row.kind),
    files: safeCount(row.files),
    bytes: safeCount(row.bytes),
    local: safeCount(row.local),
  }));
  const totals = objects.reduce(
    (sum, row) => ({
      files: safeCount(sum.files + row.files),
      bytes: safeCount(sum.bytes + row.bytes),
      local: safeCount(sum.local + row.local),
    }),
    { files: 0, bytes: 0, local: 0 },
  );
  const serverMajor = Math.floor(safeCount(metadata.version) / 10000);
  const appTables = safeCount(metadata.tables);
  const appliedMigrations = safeCount(metadata.migrations);
  if (
    serverMajor < 15 ||
    appTables < 1 ||
    appTables > 500 ||
    appliedMigrations < 1 ||
    appliedMigrations > 10000
  )
    throw new Error("BACKUP_INVENTORY_FAILED");
  return {
    serverMajor,
    appTables,
    appliedMigrations,
    expectedReferencedObjects: totals.files,
    expectedReferencedBytes: totals.bytes,
    localReferences: totals.local,
    storageObjectBytesVerified: false,
  };
}
export async function restoreTargetInventory(query: BackupQuery) {
  // This never bypasses RLS. PostgreSQL refuses counts that would silently omit protected users.
  // SET LOCAL is scoped to the caller's read-only transaction and adds no privileges.
  await query("set local row_security=off");
  const [row] = await query(
    "select current_setting('transaction_read_only') as readonly,current_setting('row_security') as row_security,(select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='sliper' and c.relkind in ('r','p')) as tables,(select count(*)::text from auth.users) as users",
  );
  if (!row || row.readonly !== "on" || row.row_security !== "off")
    throw new Error("BACKUP_TARGET_FAILED");
  return { emptyApplication: safeCount(row.tables) === 0 && safeCount(row.users) === 0 };
}
export function pgToolMajor(text: string, tool: "pg_dump" | "pg_restore") {
  const match = new RegExp("^" + tool + " \\(PostgreSQL\\) (\\d+)\\.").exec(text.trim());
  if (!match) throw new Error("PG_TOOL_UNAVAILABLE");
  return Number(match[1]);
}
export interface BackupCheck {
  id: string;
  status: "pass" | "fail" | "warn";
  message: string;
}
export function backupPreflightReport(checks: BackupCheck[]) {
  return {
    mode: "read-only-readiness",
    checks,
    backupCreated: false,
    restorePerformed: false,
    objectsDownloaded: false,
    deliveryWorkersStarted: false,
    summary: checks.reduce((sum, check) => ({ ...sum, [check.status]: sum[check.status] + 1 }), {
      pass: 0,
      warn: 0,
      fail: 0,
    }),
  };
}
