import "dotenv/config";
import { test, expect } from "@playwright/test";
import pg from "pg";
import crypto from "node:crypto";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";

// A separate database/server protects the presentation's existing roster and codes.
const origin = "http://localhost:5056";
test.use({ baseURL: origin, actionTimeout: 10000 });
const database =
  "sivee_test_httprecoverybrowser" + crypto.randomBytes(4).toString("hex");
let owner: pg.Client,
  child: ChildProcess,
  created = false;
test.beforeAll(async () => {
  const migration = new URL(process.env.MIGRATION_DATABASE_URL!),
    app = new URL(process.env.DATABASE_URL!);
  owner = new pg.Client({ connectionString: migration.toString() });
  await owner.connect();
  await owner.query(`CREATE DATABASE "${database}"`);
  created = true;
  migration.pathname = "/" + database;
  app.pathname = "/" + database;
  const env = {
    ...process.env,
    DATABASE_URL: app.toString(),
    MIGRATION_DATABASE_URL: migration.toString(),
    SIVEE_ENV: "test",
    ALLOW_DEMO_RESET: "false",
    PORT: "5056",
    WEB_ORIGIN: origin,
  };
  for (const script of ["scripts/migrate.ts", "apps/api/prisma/seed-demo.ts"])
    execFileSync(process.execPath, ["--import", "tsx", script], {
      env,
      stdio: "pipe",
    });
  child = spawn(process.execPath, ["dist/api/main.js"], { env, stdio: "pipe" });
  child.stdout?.resume();
  child.stderr?.resume();
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null)
      throw new Error("El servidor aislado no pudo iniciar.");
    try {
      if ((await fetch(origin + "/api/v1/health/ready")).ok) {
        ready = true;
        break;
      }
    } catch {
      /* waiting for this server */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(ready).toBe(true);
});
test.afterAll(async () => {
  if (child && child.exitCode === null) {
    const stopped = new Promise<void>((r) => child.once("exit", () => r()));
    child.kill("SIGTERM");
    await stopped;
  }
  if (created) await owner.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  if (owner) await owner.end();
});
async function stateElection(state: "PUBLICADA" | "BORRADOR") {
  const url = new URL(process.env.MIGRATION_DATABASE_URL!);
  url.pathname = "/" + database;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query("UPDATE elections SET state=$1", [state]);
  } finally {
    await client.end();
  }
}
async function login(page: import("@playwright/test").Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Correo electrónico").fill("comite@sivee.demo");
  await page.getByLabel("Contraseña", { exact: true }).fill("DemoSivee2026!");
  await page.getByRole("button", { name: "Ingresar al panel" }).click();
  await expect(page).toHaveURL(origin + "/admin");
}
test("Un dashboard publicado consulta una vez y no reconecta eventos", async ({
  page,
}) => {
  await stateElection("PUBLICADA");
  await page.clock.install();
  let events = 0,
    reads = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/events")) events++;
    if (request.url().endsWith("/turnout")) reads++;
  });
  await login(page);
  await expect(page.getByText("Finalizada", { exact: true })).toBeVisible();
  await page.clock.fastForward(120000);
  expect(events).toBe(0);
  expect(reads).toBe(1);
});
test("El 429 HTML muestra la espera, respeta Retry-After y recupera la participación", async ({
  page,
}) => {
  await stateElection("BORRADOR");
  await page.clock.install();
  let reads = 0,
    events = 0;
  await page.route("**/api/v1/admin/elections/*/turnout", async (route) => {
    reads++;
    if (reads === 1)
      await route.fulfill({
        status: 429,
        headers: { "Content-Type": "text/html", "Retry-After": "120" },
        body: "<html>Too many requests</html>",
      });
    else await route.continue();
  });
  await page.route("**/api/v1/admin/elections/*/events", async (route) => {
    events++;
    await route.fulfill({
      status: 429,
      headers: { "Content-Type": "text/html" },
      body: "Rate limited",
    });
  });
  await login(page);
  await expect(
    page.getByText(
      "Demasiadas solicitudes. Espera 120 segundos antes de volver a intentar.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(events).toBe(0);
  expect(reads).toBe(1);
  await page.clock.fastForward(119000);
  expect(reads).toBe(1);
  await page.clock.fastForward(1000);
  await expect(
    page.getByText("Electores habilitados", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Se interrumpió la actualización en vivo. Se reintentará con una pausa.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(reads).toBe(2);
  expect(events).toBe(1);
  await page.clock.fastForward(29000);
  expect(reads).toBe(2);
  await page.clock.fastForward(1000);
  await expect.poll(() => reads).toBe(3);
  await page.getByRole("link", { name: "Configuración", exact: true }).click();
  const before = reads;
  await page.clock.fastForward(300000);
  expect(reads).toBe(before);
});
