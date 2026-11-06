import "dotenv/config";
import pg from "pg";
import fs from "node:fs";
import crypto from "node:crypto";
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL es necesaria para migrar.");
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(762643211)");
  await client.query(
    "CREATE TABLE IF NOT EXISTS sivee_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of fs.readdirSync("apps/api/prisma/migrations").sort()) {
    const file = `apps/api/prisma/migrations/${name}/migration.sql`;
    if (!fs.existsSync(file)) continue;
    const sql = fs.readFileSync(file, "utf8");
    if (sql.trim().length < 20)
      throw new Error("Migración vacía: no se aplicó.");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    const prior = await client.query(
      "SELECT checksum FROM sivee_migrations WHERE name=$1",
      [name],
    );
    if (prior.rowCount) {
      if (prior.rows[0].checksum !== checksum)
        throw new Error("Una migración aplicada fue modificada.");
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO sivee_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
      await client.query("COMMIT");
      console.log("Migración aplicada:", name);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }
  const app = new URL(process.env.DATABASE_URL!);
  if (app.username !== "sivee_app")
    throw new Error("Se requiere el rol restringido sivee_app.");
  const existing = await client.query(
    "SELECT 1 FROM pg_roles WHERE rolname='sivee_app'",
  );
  const pass = decodeURIComponent(app.password).replaceAll("'", "''");
  if (!existing.rowCount)
    await client.query(
      `CREATE ROLE sivee_app LOGIN PASSWORD '${pass}' NOSUPERUSER NOCREATEDB NOCREATEROLE`,
    );
  await client.query("GRANT USAGE ON SCHEMA public TO sivee_app");
  await client.query(
    "GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO sivee_app",
  );
  await client.query(
    "REVOKE UPDATE, DELETE, TRUNCATE ON ballots, audit, reports, roster_imports FROM sivee_app",
  );
  await client.query(
    'GRANT UPDATE (state, "approvedBy") ON reports TO sivee_app',
  );
  await client.query("REVOKE ALL ON sivee_migrations FROM sivee_app");
  console.log("Rol API con privilegios mínimos aplicado.");
} finally {
  await client.end();
}
