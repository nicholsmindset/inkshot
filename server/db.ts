import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { verifyDeploymentEnvironment } from "./deployment-environment.js";
import { supabaseCa } from "./supabase-ca.js";
export type Queryable = {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
};
export type Database = Queryable & {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};
export async function createDatabase(
  directory = config.dataDir,
  forceLocal = false,
): Promise<Database> {
  let db: Database;
  if (process.env.DATABASE_URL && !forceLocal) {
    const connection = new URL(process.env.DATABASE_URL);
    const isSupabase = connection.hostname.endsWith('.pooler.supabase.com') || connection.hostname.endsWith('.supabase.co');
    if (isSupabase) {
      for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) connection.searchParams.delete(key);
    }
    const pool = new pg.Pool({
      connectionString: connection.toString(),
      max: 3,
      connectionTimeoutMillis: 10000,
      ...(isSupabase ? { ssl: { rejectUnauthorized: true, ca: supabaseCa } } : {}),
    });
    return databaseFromPool(pool, process.env.BILLING_MODE === "live" || config.mode === "live",
      connection.toString(), process.env.SUPABASE_URL || "", process.env.INKSHOT_SHARED_PROJECT_LIVE === "true");
  } else {
    await mkdir(directory, { recursive: true });
    const local = await PGlite.create(path.join(directory, "postgres"));
    await local.exec(
      await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
    );
    db = {
      query: (s, p) => local.query(s, p),
      transaction: (fn) => local.transaction((tx) => fn(tx)),
      close: () => local.close(),
    };
  }
  return db;
}

// SET LOCAL applies on the same checked-out connection as every statement,
// including single queries made through a transaction-mode pooler.
export async function databaseFromPool(
  pool: pg.Pool, live: boolean, databaseUrl: string, supabaseUrl: string, shared: boolean,
): Promise<Database> {
  const transaction: Database["transaction"] = async fn => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (shared) await client.query("SET LOCAL search_path = pg_catalog, inkshot_live, pg_temp");
      const result = await fn({
        query: async <T>(sql: string, params?: unknown[]) => ({
          rows: (await client.query(sql, params)).rows as T[],
        }),
      });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  const db: Database = {
    query: <T>(sql: string, params?: unknown[]) => shared
      ? transaction(tx => tx.query<T>(sql, params))
      : pool.query(sql, params).then(result => ({ rows: result.rows as T[] })),
    transaction,
    close: () => pool.end(),
  };
  try {
    await verifyDeploymentEnvironment(db, live, databaseUrl, supabaseUrl, shared);
  } catch (error) {
    await pool.end();
    throw error;
  }
  return db;
}
