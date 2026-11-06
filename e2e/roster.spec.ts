import "dotenv/config";
import { test, expect } from "@playwright/test";
import pg from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import ExcelJS from "exceljs";
import AxeBuilder from "@axe-core/playwright";

// A separate database/server protects the presentation's existing roster and codes.
const origin = "http://localhost:5052";
test.use({ baseURL: origin, actionTimeout: 10000 });
const database = "sivee_test_browser" + crypto.randomBytes(4).toString("hex");
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
    PORT: "5052",
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
async function enter(page: any) {
  await page.goto("/admin/login");
  await page.getByLabel("Correo electrónico").fill("comite@sivee.demo");
  await page.getByLabel("Contraseña", { exact: true }).fill("DemoSivee2026!");
  await page.getByRole("button", { name: "Ingresar al panel" }).click();
  await expect(
    page.getByRole("heading", { name: "Cada participación cuenta." }),
  ).toBeVisible();
}
test("Excel, registro individual, historial tras respuesta perdida y reemisión", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await enter(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByRole("link", { name: "Padrón electoral", exact: true })
    .click();
  const book = new ExcelJS.Workbook();
  book.addWorksheet("Información");
  const sheet = book.addWorksheet("Estudiantes");
  sheet.addRow([
    "Nombres y apellidos",
    "DNI",
    "Grado",
    "Sección",
    "Turno",
    "Habilitado",
  ]);
  sheet.addRow(["Ana Excel", "00000201", 3, "A", "Mañana", "Sí"]);
  sheet.addRow(["Luis Excel", "00000202", 4, "B", "Tarde", "Sí"]);
  sheet.getRow(3).hidden = true;
  await page.getByLabel("Archivo del padrón").setInputFiles({
    name: "estudiantes.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await book.xlsx.writeBuffer()),
  });
  await expect(page.getByLabel("Hoja del Excel")).toBeVisible();
  await page.getByLabel("Hoja del Excel").selectOption("Estudiantes");
  await page.getByRole("button", { name: "Leer encabezados" }).click();
  await expect(page.getByText(/Se incluirán 1 filas ocultas/)).toBeVisible();
  await page
    .getByRole("button", { name: "Validar padrón", exact: true })
    .click();
  await expect(
    page.getByText(/2 filas · 2 nuevas · 0 ya inscritas · 0 filas con errores/),
  ).toBeVisible();
  // The server commits the import, but the browser never receives its response.
  await page.route(
    "**/roster/import-commit",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page
    .getByRole("button", { name: "Confirmar importación", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: /No hay conexión/ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("cell", { name: /estudiantes.xlsx/ }),
  ).toBeVisible();
  await expect(
    page.locator(".compact-stats > span").filter({ hasText: "habilitados" }),
  ).toContainText("52");
  await page
    .getByRole("button", { name: "Reemitir códigos del lote", exact: true })
    .click();
  await page
    .getByLabel("Motivo de reemisión")
    .fill("Descarga perdida durante la prueba de red");
  await page
    .getByRole("checkbox", { name: /He verificado a los titulares/ })
    .check();
  await page
    .getByRole("button", { name: "Confirmar reemisión", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Códigos listos para entregar" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "Descargar códigos individuales",
      exact: true,
    })
    .click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("codigos-padron.csv");
  const csv = fs.readFileSync((await saved.path())!, "utf8");
  expect(csv).toContain("Ana Excel");
  expect(csv).toContain("Luis Excel");
  await page
    .getByRole("button", { name: "Registrar estudiante", exact: true })
    .click();
  await page.getByLabel("DNI del estudiante").fill("00000203");
  await page
    .getByLabel("Nombres y apellidos del estudiante", { exact: true })
    .fill("Registro Individual");
  await page
    .getByRole("button", { name: "Validar estudiante", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirmar importación", exact: true })
    .click();
  await expect(
    page.locator(".compact-stats > span").filter({ hasText: "habilitados" }),
  ).toContainText("53");
  await page.getByLabel("Documento a consultar").fill("00000203");
  await page.getByRole("button", { name: "Consultar", exact: true }).click();
  await expect(
    page
      .locator(".student-result")
      .getByText("Registro Individual", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reemitir código", exact: true })
    .click();
  await page
    .getByLabel("Motivo de reemisión")
    .fill("Verificación de identidad y código extraviado");
  await page
    .getByRole("checkbox", { name: /He verificado a los titulares/ })
    .check();
  await page
    .getByRole("button", { name: "Confirmar reemisión", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Códigos listos para entregar" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Excel o CSV", exact: true }).click();
  const invalid =
    "dni,apellidos_nombres,grado,seccion,turno,habilitado\nbad,Ana Demo,3,A,MANANA,true\n\n00000204,Ana Demo,3,A,MANANA,true\n00000204,Ana Demo,3,A,MANANA,true";
  await page.getByLabel("Archivo del padrón").setInputFiles({
    name: "errores.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(invalid),
  });
  await page
    .getByRole("button", { name: "Validar padrón", exact: true })
    .click();
  await expect(
    page.getByText(/3 filas · 1 nuevas · 0 ya inscritas · 2 filas con errores/),
  ).toBeVisible();
  await expect(
    page.getByText(/Fila 5 · DNI: Documento duplicado/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirmar importación", exact: true }),
  ).toHaveCount(0);
  fs.mkdirSync("artifacts/screenshots", { recursive: true });
  await page.screenshot({
    path: "artifacts/screenshots/padron-excel-individual.png",
    fullPage: true,
  });
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  expect(errors).toEqual([]);
});
test("menú lateral permite llegar al final con pantalla baja y móvil", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 600 });
  await enter(page);
  const sidebar = page.getByRole("complementary", {
    name: "Menú de administración",
  });
  const sizes = await sidebar.evaluate((el) => ({
    height: el.clientHeight,
    content: el.scrollHeight,
  }));
  expect(sizes.content).toBeGreaterThan(sizes.height);
  await sidebar.hover();
  await page.mouse.wheel(0, 1200);
  await expect
    .poll(() => sidebar.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await expect(
    sidebar.getByRole("button", { name: "Cerrar sesión" }),
  ).toBeInViewport({ ratio: 1 });
  await sidebar.focus();
  await page.keyboard.press("Home");
  await expect.poll(() => sidebar.evaluate((el) => el.scrollTop)).toBe(0);
  await page.keyboard.press("End");
  await expect
    .poll(() =>
      sidebar.evaluate(
        (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
      ),
    )
    .toBeLessThan(2);
  await expect(
    sidebar.getByRole("button", { name: "Cerrar sesión" }),
  ).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: "artifacts/screenshots/menu-escritorio-scroll.png",
  });
  await page.setViewportSize({ width: 390, height: 600 });
  await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
  await sidebar.hover();
  await page.mouse.wheel(0, 1400);
  await expect
    .poll(() =>
      sidebar.evaluate(
        (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
      ),
    )
    .toBeLessThan(2);
  await expect(
    sidebar.getByRole("button", { name: "Cerrar sesión" }),
  ).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: "artifacts/screenshots/menu-movil-scroll.png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
