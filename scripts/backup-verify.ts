import "dotenv/config";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import crypto from "node:crypto";
import pg from "pg";
if (process.env.SIVEE_ENV !== "demo")
  throw new Error("Este ensayo de restauración solo admite DEMO.");
const url = new URL(process.env.MIGRATION_DATABASE_URL!);
if (url.pathname !== "/sivee_demo") throw new Error("Base DEMO requerida.");
fs.mkdirSync(".data/backups", { recursive: true, mode: 0o700 });
if (!fs.existsSync(".data/backup.key"))
  fs.writeFileSync(".data/backup.key", crypto.randomBytes(32), {
    mode: 0o600,
    flag: "wx",
  });
const key = fs.readFileSync(".data/backup.key");
const docker = (args: string[], input?: Buffer) =>
  execFileSync("docker", args, {
    input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
const container = docker([
  "compose",
  "--env-file",
  ".env",
  "-f",
  "infra/compose.demo.yaml",
  "ps",
  "-q",
  "db",
])
  .toString()
  .trim();
if (!container) throw new Error("PostgreSQL DEMO no está iniciado.");
const dump = docker([
  "exec",
  container,
  "pg_dump",
  "-U",
  "sivee_owner",
  "--format=custom",
  "--no-owner",
  "sivee_demo",
]);
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const encrypted = Buffer.concat([
  iv,
  cipher.update(dump),
  cipher.final(),
  cipher.getAuthTag(),
]);
const file =
  ".data/backups/sivee-demo-" +
  new Date().toISOString().replace(/[:.]/g, "-") +
  ".enc";
fs.writeFileSync(file, encrypted, { mode: 0o600 });
const saved = fs.readFileSync(file);
const decipher = crypto.createDecipheriv(
  "aes-256-gcm",
  key,
  saved.subarray(0, 12),
);
decipher.setAuthTag(saved.subarray(-16));
const plain = Buffer.concat([
  decipher.update(saved.subarray(12, -16)),
  decipher.final(),
]);
const c = new pg.Client({ connectionString: url.toString() });
await c.connect();
const restore = "sivee_test_restore_" + crypto.randomBytes(4).toString("hex");
await c.query(`CREATE DATABASE "${restore}"`);
try {
  docker(
    [
      "exec",
      "-i",
      container,
      "pg_restore",
      "-U",
      "sivee_owner",
      "--exit-on-error",
      "--no-owner",
      "--dbname",
      restore,
    ],
    plain,
  );
  url.pathname = "/" + restore;
  const restored = new pg.Client({ connectionString: url.toString() });
  await restored.connect();
  try {
    const query = `SELECT e.id, (SELECT count(*)::int FROM ballots b WHERE b."electionId"=e.id) AS ballots, (SELECT count(*)::int FROM participations p WHERE p."electionId"=e.id AND p.state='VOTO_EMITIDO') AS participants FROM elections e ORDER BY e.id`;
    const a = (await c.query(query)).rows;
    const b = (await restored.query(query)).rows;
    if (
      JSON.stringify(a) !== JSON.stringify(b) ||
      b.some((r) => r.ballots !== r.participants)
    )
      throw new Error("La restauración no concilia.");
    const evidence = {
      executedAt: new Date().toISOString(),
      encryptedBackup: file,
      sha256: crypto.createHash("sha256").update(saved).digest("hex"),
      bytes: saved.length,
      elections: b.length,
      ballots: b.reduce((s, r) => s + r.ballots, 0),
      restoredAndReconciled: true,
    };
    fs.mkdirSync("artifacts", { recursive: true });
    fs.writeFileSync(
      "artifacts/backup-results.json",
      JSON.stringify(evidence, null, 2),
    );
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await restored.end();
  }
} finally {
  await c.query(`DROP DATABASE "${restore}" WITH (FORCE)`);
  await c.end();
}
