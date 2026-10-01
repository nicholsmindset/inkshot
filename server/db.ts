import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
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
): Promise<Database> {
  let db: Database;
  if (process.env.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
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
    await pool.query(
      await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
    );
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
