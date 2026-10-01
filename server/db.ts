import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
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
    db = {
      query: async <T>(sql: string, params?: unknown[]) => ({
        rows: (await pool.query(sql, params)).rows as T[],
      }),
      transaction: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await fn({
            query: async <T>(s: string, p?: unknown[]) => ({
              rows: (await client.query(s, p)).rows as T[],
            }),
          });
          await client.query("COMMIT");
          return result;
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
    // Hosted schemas are managed by migrations, never by application startup.
    await pool.query('SELECT 1');
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
