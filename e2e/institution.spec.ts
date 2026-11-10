import "dotenv/config";
import { test, expect } from "@playwright/test";
import pg from "pg";
import crypto from "node:crypto";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";

// A separate database/server protects the presentation's existing roster and codes.
const origin = "http://localhost:5057";
test.use({ baseURL: origin, actionTimeout: 10000 });
const database =
  "sivee_test_institutionbrowser" + crypto.randomBytes(4).toString("hex");
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
    PORT: "5057",
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
test("Crear y configurar otra elección conserva el colegio del ensayo publicado sin errores 409", async ({
  page,
}) => {
  const url = new URL(process.env.MIGRATION_DATABASE_URL!);
  url.pathname = "/" + database;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query("UPDATE elections SET state='PUBLICADA'");
  } finally {
    await client.end();
  }
  const institutionErrors: number[] = [];
  page.on("response", (response) => {
    if (
      response.url().endsWith("/api/v1/admin/institution") &&
      response.status() >= 400
    )
      institutionErrors.push(response.status());
  });
  await page.goto("/admin/login");
  await page.getByLabel("Correo electrónico").fill("comite@sivee.demo");
  await page.getByLabel("Contraseña", { exact: true }).fill("DemoSivee2026!");
  await page.getByRole("button", { name: "Ingresar al panel" }).click();
  await expect(page).toHaveURL(origin + "/admin");
  const oldId = (
    await (await page.request.get(origin + "/api/v1/admin/elections")).json()
  ).data[0].id;
  const identity = (
    await (await page.request.get(origin + "/api/v1/admin/institution")).json()
  ).data;
  expect(identity.identityLocked).toBe(true);
  await page.getByRole("link", { name: "Configuración", exact: true }).click();
  await page
    .getByRole("button", { name: "Nueva elección", exact: true })
    .click();
  await page
    .getByLabel("Nombre de la elección", { exact: true })
    .fill("Nueva elección tras el ensayo publicado");
  await page
    .getByRole("button", { name: "Crear elección", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Guardar configuración", exact: true }),
  ).toBeVisible();
  const newId = await page
    .getByRole("combobox", { name: "Elección activa" })
    .inputValue();
  expect(newId).not.toBe(oldId);
  await expect(
    page.getByLabel("Nombre de la institución", { exact: true }),
  ).toHaveValue(identity.name);
  await expect(
    page.getByLabel("Nombre de la institución", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Código institucional", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Guardar institución", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "El nombre y código del colegio ya están guardados y se conservan para las elecciones anteriores. La nueva elección los utiliza automáticamente; puedes continuar con su padrón, listas y horarios.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByLabel("Contacto de ayuda", { exact: true })
    .fill("Contacto sintético del nuevo proceso");
  await page
    .getByRole("button", { name: "Guardar configuración", exact: true })
    .click();
  await expect(
    page.getByText("La configuración fue guardada.", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Inicio permitido (opcional)", { exact: true })
    .first()
    .fill("2027-11-13T08:00");
  await page
    .getByRole("button", { name: "Guardar horarios", exact: true })
    .click();
  await expect(
    page.getByText("Horarios guardados.", { exact: true }),
  ).toBeVisible();
  // Old clients submitting identical shared data must succeed as well.
  const me = (
    await (await page.request.get(origin + "/api/v1/admin/me")).json()
  ).data;
  const response = await page.request.patch(
    origin + "/api/v1/admin/institution",
    {
      headers: { Origin: origin, "X-CSRF-Token": me.csrfToken },
      data: { name: identity.name, code: identity.code },
    },
  );
  expect(response.status()).toBe(200);
  expect(institutionErrors).toEqual([]);
  await page.reload();
  const original = (
    await (
      await page.request.get(origin + "/api/v1/admin/elections/" + oldId)
    ).json()
  ).data;
  expect(original.state).toBe("PUBLICADA");
  expect(original.institution.name).toBe(identity.name);
});
