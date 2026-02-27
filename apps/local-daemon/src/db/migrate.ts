import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";

export function runMigrations(db: Database.Database) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const localSchemaPath = path.join(__dirname, "schema-v1.sql");
  const sourceSchemaPath = path.resolve(__dirname, "../../src/db/schema-v1.sql");
  const schemaPath = fs.existsSync(localSchemaPath) ? localSchemaPath : sourceSchemaPath;
  const sql = fs.readFileSync(schemaPath, "utf8");
  db.exec(sql);
}
