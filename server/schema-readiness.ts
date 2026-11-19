import type { Queryable } from "./db.js";

export const schemaReadinessCodes = [
  "SCHEMA_CAMPAIGN_PLANNING_REQUIRED",
  "SCHEMA_SHARED_RATE_LIMITS_REQUIRED",
  "SCHEMA_PHOTO_VIDEO_REQUIRED",
  "SCHEMA_ACCOUNT_DELETION_REQUIRED",
] as const;
type SchemaCode = (typeof schemaReadinessCodes)[number];

export class SchemaReadinessError extends Error {
  constructor(readonly code: SchemaCode) {
    super("The database schema does not match this release. Follow LAUNCH_CHECKLIST.md before deployment.");
  }
}

// Read metadata only, using the runtime role and its actual search path. Never
// migrate a hosted database or let a public table stand in for a missing live one.
export async function verifySchemaReadiness(db: Queryable, shared = false) {
  const requirements = [
    { table_name: "versions", column_name: "video_duration_seconds", column_type: "integer", code: schemaReadinessCodes[2] },
    { table_name: "versions", column_name: "first_frame_source", column_type: "text", code: schemaReadinessCodes[2] },
    { table_name: "campaigns", column_name: "draft", column_type: "jsonb", code: schemaReadinessCodes[0] },
    { table_name: "versions", column_name: "motion_prompt", column_type: "text", code: schemaReadinessCodes[0] },
    { table_name: "rate_limit_buckets", column_name: "bucket_key", column_type: "text", code: schemaReadinessCodes[1] },
    { table_name: "rate_limit_buckets", column_name: "hits", column_type: "integer", code: schemaReadinessCodes[1] },
    { table_name: "rate_limit_buckets", column_name: "expires_at", column_type: "timestamp with time zone", code: schemaReadinessCodes[1] },
    { table_name: "workspaces", column_name: "deletion_requested_at", column_type: "timestamp with time zone", code: schemaReadinessCodes[3] },
    { table_name: "account_deletions", column_name: "user_hash", column_type: "text", code: schemaReadinessCodes[3] },
    { table_name: "account_deletions", column_name: "provider_deleted", column_type: "jsonb", code: schemaReadinessCodes[3] },
  ];
  const { rows } = await db.query<{ code: SchemaCode }>(`
    SELECT required.code
    FROM jsonb_to_recordset($1::jsonb)
      AS required(table_name text, column_name text, column_type text, code text)
    LEFT JOIN pg_catalog.pg_namespace ns ON ns.nspname = $2
    LEFT JOIN pg_catalog.pg_class tbl
      ON tbl.relnamespace = ns.oid AND tbl.relname = required.table_name AND tbl.relkind IN ('r', 'p')
    LEFT JOIN pg_catalog.pg_attribute col
      ON col.attrelid = tbl.oid AND col.attname = required.column_name
      AND col.attnum > 0 AND NOT col.attisdropped
    WHERE col.atttypid IS DISTINCT FROM pg_catalog.to_regtype(required.column_type)::oid
      OR pg_catalog.to_regclass(pg_catalog.quote_ident(required.table_name))::oid IS DISTINCT FROM tbl.oid
  `, [JSON.stringify(requirements), shared ? "inkshot_live" : "public"]);
  // Choose only a code from the fixed contract, never an arbitrary database value.
  for (const code of schemaReadinessCodes) {
    if (rows.some(row => row.code === code)) throw new SchemaReadinessError(code);
  }
}
