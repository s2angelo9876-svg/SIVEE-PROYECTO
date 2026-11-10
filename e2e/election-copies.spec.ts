import "dotenv/config";
import { test, expect } from "@playwright/test";
import pg from "pg";
import crypto from "node:crypto";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { schoolFixture } from "../tests/school-fixture";
import { logoData, logoPng } from "../tests/list-logo.fixture";

// A separate database/server protects the presentation's existing roster and codes.
const origin = "http://localhost:5054";
test.use({ baseURL: origin, actionTimeout: 10000 });
const database =
  "sivee_test_copiesbrowser" + crypto.randomBytes(4).toString("hex");
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
    PORT: "5054",
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
test("Guardar una copia y recuperar el padrón, extranjeros y listas en una nueva elección sin votos", async ({
  page,
}) => {
  await page.goto("/admin/login");
  await page.getByLabel("Correo electrónico").fill("comite@sivee.demo");
  await page.getByLabel("Contraseña", { exact: true }).fill("DemoSivee2026!");
  await page.getByRole("button", { name: "Ingresar al panel" }).click();
  await expect(page).toHaveURL(origin + "/admin");
  const me = (
    await (await page.request.get(origin + "/api/v1/admin/me")).json()
  ).data;
  const headers = { Origin: origin, "X-CSRF-Token": me.csrfToken };
  async function post(path: string, data: unknown, method = "POST") {
    const response = await page.request.fetch(origin + "/api/v1" + path, {
      method,
      headers,
      data,
    });
    const body = await response.json();
    expect(response.ok(), JSON.stringify(body)).toBe(true);
    return body.data;
  }
  const input = {
    name: "Elección con configuración guardada",
    year: 2027,
    scope: "Municipio escolar",
    blankAllowed: true,
    nullAllowed: false,
    regulation: "Reglamento sintético",
    contact: "Comité sintético",
    institutionalApprovalReference: "Acta sintética del ensayo",
    shifts: ["MANANA", "TARDE"],
  };
  const source = await post("/admin/elections", input);
  const root = "/admin/elections/" + source.id;
  await post(root + "/roster/school/import", await schoolFixture(27));
  const state = (
    await (
      await page.request.get(origin + "/api/v1" + root + "/roster/school")
    ).json()
  ).data;
  await post(root + "/roster/school/foreign-students", {
    rowIds: state.rows
      .filter((r: any) => r.foreignCandidate)
      .map((r: any) => r.id),
    reason: "Habilitación sintética de extranjeros para la copia",
  });
  for (const number of [1, 2])
    await post(root + "/lists", {
      number,
      name: "Lista Guardada " + number,
      symbol: logoData(logoPng()),
      color: "#167568",
      candidates: [{ name: "Candidatura Sintética", position: "Alcaldía" }],
      proposal: "Propuesta guardada",
      active: true,
    });
  await page.goto("/admin/configuracion");
  await page
    .getByRole("combobox", { name: "Elección activa" })
    .selectOption(source.id);
  const panel = page.getByRole("region", { name: "Copias de configuración" });
  await expect(
    panel.getByRole("button", { name: "Guardar copia", exact: true }),
  ).toBeEnabled();
  // Unsaved settings must not silently be omitted from the copy.
  await page
    .getByLabel("Nombre de la elección", { exact: true })
    .fill("Cambio sin guardar");
  await expect(
    panel.getByRole("button", { name: "Guardar copia", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Nombre de la elección", { exact: true })
    .fill(input.name);
  await page
    .getByLabel("Inicio permitido (opcional)", { exact: true })
    .first()
    .fill("2027-11-13T08:00");
  await expect(
    panel.getByRole("button", { name: "Guardar copia", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Guardar horarios", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Guardar copia", exact: true }),
  ).toBeEnabled();
  await panel
    .getByRole("button", { name: "Guardar copia", exact: true })
    .click();
  await page
    .getByLabel("Nombre de la copia", { exact: true })
    .fill("Antes de iniciar el ensayo");
  await page
    .getByRole("button", { name: "Confirmar copia", exact: true })
    .click();
  await expect(
    panel.getByText("Antes de iniciar el ensayo", { exact: true }),
  ).toBeVisible();
  await expect(panel).toContainText(
    "27 registros · 27 habilitados · 25 extranjeros · 2 listas",
  );
  await post(
    root,
    {
      ...input,
      name: "Nombre cambiado después de la copia",
      nullAllowed: true,
    },
    "PATCH",
  );
  await page.reload();
  await expect(
    page.getByLabel("Nombre de la elección", { exact: true }),
  ).toHaveValue("Nombre cambiado después de la copia");
  await panel
    .getByRole("button", { name: "Recuperar como nueva elección", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirmar recuperación", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Nombre de la elección recuperada", { exact: true })
    .fill("Elección nueva recuperada");
  await page
    .getByLabel("Escribe CREAR NUEVA ELECCION para confirmar", { exact: true })
    .fill("CREAR NUEVA ELECCION");
  await page
    .getByRole("button", { name: "Confirmar recuperación", exact: true })
    .click();
  await expect(
    page.getByLabel("Nombre de la elección", { exact: true }),
  ).toHaveValue("Elección nueva recuperada");
  await expect(
    page.getByLabel("Autorizar opción de voto nulo"),
  ).not.toBeChecked();
  await expect(
    page.getByText(
      "La copia se recuperó en una nueva elección en borrador, sin votos. Revisa sus horarios y configuración antes de prepararla.",
    ),
  ).toBeVisible();
  const restoredId = await page
    .getByRole("combobox", { name: "Elección activa" })
    .inputValue();
  expect(restoredId).not.toBe(source.id);
  const old = (await (await page.request.get(origin + "/api/v1" + root)).json())
    .data;
  expect(old.name).toBe("Nombre cambiado después de la copia");
  const restored = (
    await (
      await page.request.get(origin + "/api/v1/admin/elections/" + restoredId)
    ).json()
  ).data;
  expect(restored.state).toBe("BORRADOR");
  expect(restored.windows.find((w: any) => w.shift === "MANANA").startsAt).toBe(
    "2027-11-13T13:00:00.000Z",
  );
  expect(restored.windows.every((w: any) => w.state === "PROGRAMADA")).toBe(
    true,
  );
  await page
    .getByRole("link", { name: "Padrón electoral", exact: true })
    .click();
  await expect(page.getByText("27", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Filtrar por tipo de acceso").selectOption("FOREIGN");
  await expect(
    page.getByText("25 coincidencias · Página 1 de 1"),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Listas participantes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Lista Guardada 1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Lista Guardada 2", exact: true }),
  ).toBeVisible();
});
