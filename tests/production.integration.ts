import "dotenv/config";
import pg from "pg";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
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
let client: pg.Client | undefined, server: ChildProcess | undefined;
const checkAccess = (password: string) =>
  JSON.parse(
    run("dist/ops/check-admin-access.js", {
      INITIAL_ADMIN_PASSWORD: password,
    }).toString(),
  );
try {
  run("dist/ops/initialize-production.js");
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
  assert.equal(checkAccess(env.INITIAL_ADMIN_PASSWORD).passwordMatches, true);
  const missingAccount = JSON.parse(
    run("dist/ops/check-admin-access.js", {
      INITIAL_ADMIN_EMAIL: "missing@example.invalid",
    }).toString(),
  );
  assert.equal(missingAccount.accountFound, false);
  assert.equal(missingAccount.adminCount, 1);
  assert.equal(missingAccount.institutionCount, 1);
  assert.equal(missingAccount.passwordMatches, null);
  assert.equal(
    checkAccess("UnaClaveDistintaParaElEnsayo123!").passwordMatches,
    false,
  );
  const beforeCheck = JSON.stringify(
    (await client.query("SELECT * FROM admins ORDER BY id")).rows,
  );
  const auditBefore = (await client.query("SELECT count(*)::int n FROM audit"))
    .rows[0].n;
  assert.equal(checkAccess(env.INITIAL_ADMIN_PASSWORD).readOnly, true);
  assert.equal(
    JSON.stringify(
      (await client.query("SELECT * FROM admins ORDER BY id")).rows,
    ),
    beforeCheck,
  );
  assert.equal(
    (await client.query("SELECT count(*)::int n FROM audit")).rows[0].n,
    auditBefore,
  );
  const port = await new Promise<number>((resolve) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address() as net.AddressInfo;
      probe.close(() => resolve(address.port));
    });
  });
  server = spawn(process.execPath, ["dist/api/main.js"], {
    env: { ...env, PORT: String(port) },
    stdio: "pipe",
  });
  server.stdout?.resume();
  server.stderr?.resume();
  const base = `http://127.0.0.1:${port}/api/v1`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null)
      throw new Error("La API oficial aislada no pudo iniciar.");
    try {
      if ((await fetch(base + "/health/ready")).ok) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for this server. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(ready, true);
  async function login(password: string) {
    return fetch(base + "/admin/auth/login", {
      method: "POST",
      headers: { Origin: env.WEB_ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ email: env.INITIAL_ADMIN_EMAIL, password }),
    });
  }
  const initialLogin = await login(env.INITIAL_ADMIN_PASSWORD);
  assert.equal(initialLogin.status, 200);
  assert.equal((await initialLogin.json()).data.mfaSetupRequired, undefined);
  assert.equal((await login("UnaClaveDistintaParaElEnsayo123!")).status, 401);

  assert.throws(
    () => run("dist/ops/initialize-production.js"),
    (error: any) =>
      error.status === 1 &&
      error.stderr.toString().includes("La instalación ya contiene"),
  );
  assert.throws(
    () =>
      run("dist/ops/initialize-production.js", { MIGRATION_DATABASE_URL: "" }),
    (error: any) =>
      error.status === 1 &&
      !error.stdout.toString().includes("ejecutando bootstrap-production.js"),
  );
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
  const recoveryPassword = crypto.randomBytes(24).toString("base64url");
  run("dist/ops/recover-account.js", {
    RECOVERY_EMAIL: user.email,
    RECOVERY_PASSWORD: recoveryPassword,
    RECOVERY_REASON: "Titular sintético verificado para recuperación",
  });
  const recovered = (await client.query("SELECT * FROM admins")).rows[0];
  assert.equal((await login(env.INITIAL_ADMIN_PASSWORD)).status, 401);
  assert.equal(checkAccess(recoveryPassword).passwordMatches, true);
  assert.equal(checkAccess(env.INITIAL_ADMIN_PASSWORD).passwordMatches, false);
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
  assert.equal((await login(recoveryPassword)).status, 200);
  console.log(
    "PASS Instalación oficial, login HTTP con contraseña inicial, rechazo de clave distinta, comprobación sin cambios y login tras recuperación.",
  );
} finally {
  if (server && server.exitCode === null) {
    const stopped = new Promise<void>((resolve) =>
      server!.once("exit", () => resolve()),
    );
    server.kill("SIGTERM");
    await stopped;
  }
  if (client) await client.end();
  await owner.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await owner.end();
}
