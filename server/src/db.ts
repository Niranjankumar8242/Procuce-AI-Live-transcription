import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  ssl: config.NODE_ENV === "production" && !config.DATABASE_URL.includes("sslmode=disable")
    ? { rejectUnauthorized: false }
    : undefined
});

export async function migrate(): Promise<void> {
  const migrationPath = path.resolve(process.cwd(), "server/migrations/001_create_transcriptions.sql");
  const sql = await readFile(migrationPath, "utf8");
  await pool.query(sql);
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
