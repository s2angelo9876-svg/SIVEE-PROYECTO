import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import dotenv from "dotenv";
if (!fs.existsSync(".env")) {
  const secret = () => crypto.randomBytes(32).toString("hex");
  const password = secret();
  const appPassword = secret();
  fs.writeFileSync(
    ".env",
    `NODE_ENV=development\nSIVEE_ENV=demo\nPORT=5000\nWEB_ORIGIN=http://localhost:5173\nPOSTGRES_PASSWORD=${password}\nDATABASE_URL=postgresql://sivee_app:${appPassword}@127.0.0.1:5432/sivee_demo\nMIGRATION_DATABASE_URL=postgresql://sivee_owner:${password}@127.0.0.1:5432/sivee_demo\nDNI_LOOKUP_KEY=${secret()}\nSESSION_PEPPER=${secret()}\nCSRF_KEY=${secret()}\nCOOKIE_SECURE=false\nALLOW_DEMO_RESET=true\n`,
    { mode: 0o600, flag: "wx" },
  );
}
dotenv.config({ quiet: true });
if (
  process.env.SIVEE_ENV !== "demo" ||
  new URL(process.env.DATABASE_URL!).pathname !== "/sivee_demo"
)
  throw new Error("Este comando solo prepara la base DEMO.");
const exec = (command: string, args: string[]) =>
  execFileSync(command, args, { stdio: "inherit", env: process.env });
exec("docker", [
  "--host=unix:///var/run/docker.sock",
  "compose",
  "--env-file",
  ".env",
  "-f",
  "infra/compose.demo.yaml",
  "up",
  "-d",
  "--wait",
  "db",
]);
exec("pnpm", ["db:generate"]);
exec("pnpm", ["db:migrate"]);
exec("pnpm", ["seed:demo"]);
console.log("DEMO preparada. Ejecuta pnpm dev. Guía: docs/DEMO.md");
