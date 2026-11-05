import "dotenv/config";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const name = "sivee-app-smoke";
const url = new URL(process.env.DATABASE_URL!);
url.hostname = "db";
const runtimeEnv = {
  ...process.env,
  DATABASE_URL: url.toString(),
  WEB_ORIGIN: "http://localhost:8080",
  PORT: "5000",
};
const docker = (args: string[]) =>
  execFileSync("docker", ["--host=unix:///var/run/docker.sock", ...args], {
    env: runtimeEnv,
    stdio: "pipe",
  });
let started = false;
try {
  docker([
    "run",
    "-d",
    "--rm",
    "--name",
    name,
    "--network",
    "sivee-demo_default",
    "-p",
    "127.0.0.1:8080:5000",
    ...[
      "DATABASE_URL",
      "WEB_ORIGIN",
      "PORT",
      "DNI_LOOKUP_KEY",
      "SESSION_PEPPER",
      "CSRF_KEY",
      "SIVEE_ENV",
      "COOKIE_SECURE",
      "ALLOW_DEMO_RESET",
    ].flatMap((k) => ["-e", k]),
    "sivee:demo",
  ]);
  started = true;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch("http://localhost:8080/api/v1/health/ready");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {
      /* waiting for the container */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) throw new Error("El contenedor no alcanzó readiness.");
  const login = await fetch("http://localhost:8080/api/v1/admin/auth/login", {
    method: "POST",
    headers: {
      Origin: "http://localhost:8080",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "comite@sivee.demo",
      password: "DemoSivee2026!",
    }),
  });
  if (!login.ok) throw new Error("Falló el acceso del comité en Docker.");
  const html = await (await fetch("http://localhost:8080")).text();
  if (!html.includes("SIVEE"))
    throw new Error("El frontend compilado no fue servido.");
  const uid = docker(["exec", name, "id", "-u"]).toString().trim();
  if (uid === "0") throw new Error("El contenedor no debe ejecutar como root.");
  const result = {
    executedAt: new Date().toISOString(),
    image: "sivee:demo",
    ready: true,
    login: true,
    frontend: true,
    nonRoot: true,
  };
  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync(
    "artifacts/docker-smoke.json",
    JSON.stringify(result, null, 2),
  );
  console.log(result);
} finally {
  if (started) docker(["stop", name]);
}
