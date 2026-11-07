import "dotenv/config";
import pg from "pg";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const original = new URL(process.env.MIGRATION_DATABASE_URL!),
  app = new URL(process.env.DATABASE_URL!);
const name = "sivee_validation_" + crypto.randomBytes(4).toString("hex");
const owner = new pg.Client({ connectionString: original.toString() });
await owner.connect();
await owner.query(`CREATE DATABASE "${name}"`);
original.pathname = "/" + name;
app.pathname = "/" + name;
const env = {
  ...process.env,
  MIGRATION_DATABASE_URL: original.toString(),
  DATABASE_URL: app.toString(),
  SIVEE_ENV: "production",
  WEB_ORIGIN: "https://validation.invalid",
  COOKIE_SECURE: "true",
  ALLOW_DEMO_RESET: "false",
  INSTITUTION_CODE: "SYNTHETIC",
  INSTITUTION_NAME: "Institución sintética de validación",
  INITIAL_ADMIN_EMAIL: "validation@example.invalid",
  INITIAL_ADMIN_NAME: "Responsable de ensayo",
  INITIAL_ADMIN_PASSWORD: crypto.randomBytes(24).toString("base64url"),
};
const run = (script: string, extra: Record<string, string> = {}) =>
  execFileSync(process.execPath, [script], {
    env: { ...env, ...extra },
    stdio: "pipe",
  });
let client: pg.Client | undefined;
try {
  run("dist/ops/migrate.js");
  run("dist/ops/bootstrap-production.js");
  client = new pg.Client({ connectionString: original.toString() });
  await client.connect();
  assert.equal(
    (await client.query("SELECT count(*)::int n FROM students")).rows[0].n,
    0,
  );
  assert.equal(
    (await client.query("SELECT count(*)::int n FROM elections")).rows[0].n,
    0,
  );
  const user = (await client.query("SELECT * FROM admins")).rows[0];
  assert.equal(user.email, env.INITIAL_ADMIN_EMAIL);
  assert.equal(user.mfaEnabled, false);
  assert.notEqual(user.passwordHash, env.INITIAL_ADMIN_PASSWORD);
  assert.throws(() => run("dist/ops/bootstrap-production.js"));
  assert.equal(
    (await client.query("SELECT count(*)::int n FROM admins")).rows[0].n,
    1,
  );
  await client.query(
    'INSERT INTO admin_sessions (id, "adminId", "tokenHash", "expiresAt", revoked) VALUES ($1,$2,$3,now()+interval \'30 minutes\',false)',
    [crypto.randomUUID(), user.id, crypto.randomBytes(32).toString("hex")],
  );
  await client.query(
    'UPDATE admins SET "mfaEnabled"=true, "mfaSecret"=$1 WHERE id=$2',
    ["synthetic", user.id],
  );
  run("dist/ops/recover-account.js", {
    RECOVERY_EMAIL: user.email,
    RECOVERY_PASSWORD: crypto.randomBytes(24).toString("base64url"),
    RECOVERY_REASON: "Titular sintético verificado para recuperación",
  });
  const recovered = (await client.query("SELECT * FROM admins")).rows[0];
  assert.equal(recovered.mfaEnabled, false);
  assert.equal(recovered.mfaSecret, null);
  assert.notEqual(recovered.passwordHash, user.passwordHash);
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int n FROM admin_sessions WHERE NOT revoked",
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int n FROM audit WHERE action='ACCOUNT_RECOVERED_BY_OPERATOR'",
      )
    ).rows[0].n,
    1,
  );
  console.log(
    "PASS Instalación oficial vacía, contraseña cifrada, rechazo de sobrescritura y recuperación con revocación y auditoría.",
  );
} finally {
  if (client) await client.end();
  await owner.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await owner.end();
}
