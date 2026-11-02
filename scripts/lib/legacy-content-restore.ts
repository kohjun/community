import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";

/** A deliberately narrow, transaction-scoped restore of public historical content.
 * The caller uploads/validates files first, and supplies a transaction query function.
 * No accounts, financial rows, notifications, votes or attendance are imported.
 */
export type LegacyRow = Record<string, unknown>;
export interface LegacyContent {
  posts: LegacyRow[];
  comments: LegacyRow[];
  media: LegacyRow[];
  settings: LegacyRow[];
}
export type RestoreQuery = (sql: string, parameters?: unknown[]) => Promise<LegacyRow[]>;
const postColumns =
  "id category_slug author_id is_anonymous title kind featured sample location event_date application_url event_fee contact_info discussion_type spoiler spoiler_title spoiler_summary topic tags poll body_markdown body_document status created_at updated_at deleted_at imported_author_name".split(
    " ",
  );
const commentColumns =
  "id post_id parent_id author_id is_anonymous body_markdown status created_at updated_at deleted_at imported_author_name".split(
    " ",
  );
const mediaColumns =
  "id uploader_id post_id record_origin_post_id record_post_id object_key storage_backend content_type byte_size status sort_order unattached_since created_at".split(
    " ",
  );
const settingsColumns =
  "post_id approval_mode questions meetup_type activity_category venue_latitude venue_longitude starts_at ends_at completed_at completed_by refund_policy amount_krw capacity open created_at updated_at".split(
    " ",
  );

function attribution(row: LegacyRow) {
  const name = row.imported_author_name;
  assert.ok(row.author_id === null, "Restored content must not inherit a login identity.");
  assert.ok(row.status === "published", "Deleted content cannot be restored.");
  assert.ok(
    row.is_anonymous
      ? name === null
      : name === null || (typeof name === "string" && name.trim().length >= 2 && name.length <= 24),
  );
}
function original(row: LegacyRow, columns: string[], ignore: string[]) {
  return Object.fromEntries(
    columns
      .filter((key) => !ignore.includes(key))
      .map((key) => {
        const value = row[key] ?? null;
        if (typeof value === "string" && (key.endsWith("_at") || key === "unattached_since")) {
          const instant = new Date(value);
          assert.ok(Number.isFinite(instant.getTime()), "Invalid historical timestamp.");
          // PostgreSQL JSON may use a different session timezone. Preserve all six
          // fractional digits while comparing the same instant across connections.
          const fraction = /\.(\d+)(?:Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value)?.[1] ?? "";
          const micros = fraction.padEnd(6, "0").slice(3, 6);
          return [key, instant.toISOString().replace(/Z$/, micros + "Z")];
        }
        return [key, value];
      }),
  );
}
async function insert(query: RestoreQuery, table: string, columns: string[], rows: LegacyRow[]) {
  if (!rows.length) return;
  const names = columns.map((column) => `"${column}"`).join(",");
  await query(
    `insert into sliper.${table} (${names}) select ${names} from jsonb_populate_recordset(null::sliper.${table}, $1::jsonb)`,
    [JSON.stringify(rows)],
  );
}

export async function restoreLegacyContent(
  query: RestoreQuery,
  payload: LegacyContent,
  transportOwner: string,
) {
  assert.ok(payload.posts.length > 0 && payload.posts.length <= 1000);
  const postIds = new Set(payload.posts.map((row) => row.id));
  assert.equal(postIds.size, payload.posts.length);
  for (const row of [...payload.posts, ...payload.comments]) attribution(row);
  for (const row of [...payload.comments, ...payload.media, ...payload.settings])
    assert.ok(postIds.has(row.post_id));
  for (const row of payload.media) {
    assert.equal(row.storage_backend, "supabase");
    assert.equal(row.status, "ready");
    assert.equal(row.uploader_id, null);
    assert.equal(row.unattached_since, null, "Attached images cannot enter orphan cleanup.");
    assert.equal(row.record_post_id, null);
    assert.equal(
      row.record_origin_post_id,
      null,
      "Record-restricted media cannot become public posts.",
    );
  }
  for (const row of payload.settings) {
    assert.equal(row.open, false, "Historical recruitment must remain closed.");
    assert.equal(row.completed_by, null);
    assert.equal(row.completed_at, null, "Completion needs a separate verified migration.");
  }
  // A partial collision never becomes an UPDATE or an overwrite of current content.
  const existing = await query(
    "select to_jsonb(p) as row from sliper.posts p where id in (select jsonb_array_elements_text($1::jsonb)::uuid)",
    [JSON.stringify([...postIds])],
  );
  if (existing.length) {
    assert.equal(
      existing.length,
      payload.posts.length,
      "Partial restore collision; manual review required.",
    );
    for (const { row } of existing) {
      const actual = row as LegacyRow,
        expected = payload.posts.find((item) => item.id === actual.id)!;
      assert.ok(
        isDeepStrictEqual(
          original(actual, postColumns, ["updated_at"]),
          original(expected, postColumns, ["updated_at"]),
        ),
        "Existing content differs; no overwrite is allowed.",
      );
    }
    for (const [table, columns, rows] of [
      ["comments", commentColumns, payload.comments],
      ["media_assets", mediaColumns, payload.media],
      ["event_settings", settingsColumns, payload.settings],
    ] as const) {
      const found = await query(
        `select to_jsonb(t) as row from sliper.${table} t where post_id in (select jsonb_array_elements_text($1::jsonb)::uuid)`,
        [JSON.stringify([...postIds])],
      );
      assert.equal(found.length, rows.length, "Restored dependencies differ.");
      for (const { row } of found) {
        const actual = row as LegacyRow,
          expected = rows.find(
            (item) => (item.id ?? item.post_id) === (actual.id ?? actual.post_id),
          );
        assert.ok(
          expected &&
            isDeepStrictEqual(
              original(actual, columns, ["updated_at"]),
              original(expected, columns, ["updated_at"]),
            ),
          "Restored dependency differs; no overwrite is allowed.",
        );
      }
    }
    return {
      alreadyRestored: true,
      posts: payload.posts.length,
      comments: payload.comments.length,
      media: payload.media.length,
    };
  }
  const [owner] = await query("select id from sliper.profiles where id=$1::uuid", [transportOwner]);
  assert.ok(
    owner,
    "An existing identity is needed only inside the transaction for insertion guards.",
  );
  // Existing signed-in-author and media guards stay enabled. Temporary ownership
  // is removed in this same transaction before any row can become visible.
  await insert(
    query,
    "posts",
    postColumns,
    payload.posts.map((row) => ({ ...row, author_id: transportOwner, imported_author_name: null })),
  );
  const pending = new Map(payload.comments.map((row) => [row.id, row]));
  const parents = new Set<unknown>();
  while (pending.size) {
    const level = [...pending.values()].filter(
      (row) => row.parent_id === null || parents.has(row.parent_id),
    );
    assert.ok(level.length, "Missing parent or cyclic reply; restore aborted.");
    await insert(
      query,
      "comments",
      commentColumns,
      level.map((row) => ({ ...row, author_id: transportOwner, imported_author_name: null })),
    );
    for (const row of level) {
      parents.add(row.id);
      pending.delete(row.id);
    }
  }
  await insert(query, "event_settings", settingsColumns, payload.settings);
  await insert(
    query,
    "media_assets",
    mediaColumns,
    payload.media.map((row) => ({ ...row, uploader_id: transportOwner })),
  );
  await query(
    "update sliper.media_assets set uploader_id=null where post_id in (select jsonb_array_elements_text($1::jsonb)::uuid)",
    [JSON.stringify([...postIds])],
  );
  for (const [table, rows] of [
    ["posts", payload.posts],
    ["comments", payload.comments],
  ] as const) {
    if (!rows.length) continue;
    await query(
      `update sliper.${table} target set author_id=null, imported_author_name=source.imported_author_name from jsonb_to_recordset($1::jsonb) as source(id uuid,imported_author_name varchar(24)) where target.id=source.id`,
      [
        JSON.stringify(
          rows.map((row) => ({ id: row.id, imported_author_name: row.imported_author_name })),
        ),
      ],
    );
  }
  const [check] = await query(
    "select count(*)::int as owned from sliper.posts where id in (select jsonb_array_elements_text($1::jsonb)::uuid) and author_id is not null",
    [JSON.stringify([...postIds])],
  );
  assert.equal(check?.owned, 0, "Temporary ownership must never be committed.");
  return {
    alreadyRestored: false,
    posts: payload.posts.length,
    comments: payload.comments.length,
    media: payload.media.length,
  };
}
