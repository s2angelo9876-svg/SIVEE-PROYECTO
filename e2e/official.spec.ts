import "dotenv/config";
import { test, expect } from "@playwright/test";
import pg from "pg";
import crypto from "node:crypto";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { schoolFixture } from "../tests/school-fixture";
import { logoPng } from "../tests/list-logo.fixture";
import AxeBuilder from "@axe-core/playwright";

// A separate database/server protects the presentation's existing roster and codes.
const origin = "http://localhost:5053";
test.use({ baseURL: origin, actionTimeout: 10000 });
const database =
  "sivee_test_officialbrowser" + crypto.randomBytes(4).toString("hex");
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
    PORT: "5053",
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
test("Padrón escolar y voto presencial en dos navegadores con verificación de mesa", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/admin/login");
  await page.getByLabel("Correo electrónico").fill("comite@sivee.demo");
  await page.getByLabel("Contraseña", { exact: true }).fill("DemoSivee2026!");
  await page.getByRole("button", { name: "Ingresar al panel" }).click();
  await expect(
    page.getByRole("heading", { name: "Cada participación cuenta." }),
  ).toBeVisible();
  const me = (
    await (await page.request.get(origin + "/api/v1/admin/me")).json()
  ).data;
  async function api(path: string, body?: unknown) {
    const response = await page.request.fetch(origin + "/api/v1" + path, {
      method: body ? "POST" : "GET",
      headers: { Origin: origin, "X-CSRF-Token": me.csrfToken },
      ...(body ? { data: body } : {}),
    });
    const result = await response.json();
    expect(response.ok(), JSON.stringify(result)).toBe(true);
    return result.data;
  }
  const election = await api("/admin/elections", {
    name: "Elección presencial del colegio",
    year: 2027,
    scope: "Municipio escolar",
    blankAllowed: true,
    nullAllowed: true,
    regulation: "Reglamento del ensayo de navegador",
    contact: "Consulta a tu mesa",
    shifts: ["MANANA", "TARDE"],
  });
  const root = "/admin/elections/" + election.id;
  await page.goto("/admin/padron");
  await expect(
    page.getByRole("heading", { name: "Padrón del colegio", exact: true }),
  ).toBeVisible();
  const pagedFixture = await schoolFixture(101, false);
  await page.getByLabel("Archivo institucional").setInputFiles({
    name: "paginado.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(pagedFixture.file.base64, "base64"),
  });
  const rosterPreview = page.getByRole("region", {
    name: "Vista previa del padrón",
  });
  const previewRows = rosterPreview.locator("tbody tr");
  const nextPage = rosterPreview.getByRole("button", {
    name: "Siguiente",
    exact: true,
  });
  const previousPage = rosterPreview.getByRole("button", {
    name: "Anterior",
    exact: true,
  });
  await expect(rosterPreview.getByRole("status")).toHaveText(
    "Mostrando 1–50 de 101 estudiantes · Página 1 de 3",
  );
  await expect(previewRows).toHaveCount(50);
  await expect(previousPage).toBeDisabled();
  await expect(previewRows.first()).toContainText("Estudiante Sintético 0");
  await expect(previewRows.last()).toContainText("Estudiante Sintético 49");
  await nextPage.click();
  await expect(previewRows).toHaveCount(50);
  await expect(rosterPreview.getByRole("status")).toHaveText(
    "Mostrando 51–100 de 101 estudiantes · Página 2 de 3",
  );
  await expect(previewRows.first()).toContainText("Estudiante Sintético 50");
  await expect(previewRows.last()).toContainText("Estudiante Sintético 99");
  await nextPage.click();
  await expect(previewRows).toHaveCount(1);
  await expect(previewRows.first()).toContainText("Estudiante Sintético 100");
  await expect(rosterPreview.getByRole("status")).toHaveText(
    "Mostrando 101–101 de 101 estudiantes · Página 3 de 3",
  );
  await expect(nextPage).toBeDisabled();
  await previousPage.click();
  await expect(previewRows.first()).toContainText("Estudiante Sintético 50");
  // Replacing the file resets the page; exactly 50 CSV rows fit on one page.
  await page.getByLabel("Archivo institucional").setInputFiles({
    name: "paginado.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "DNI,CÓDIGO DEL ESTUDIANTE,ESTUDIANTE,GRADO,SECCIÓN\n" +
        Array.from(
          { length: 50 },
          (_, i) =>
            `${20000000 + i},CSV-${i},Estudiante CSV ${i},PRIMERO,RESPETO`,
        ).join("\n"),
    ),
  });
  await expect(rosterPreview.getByRole("status")).toHaveText(
    "Mostrando 1–50 de 50 estudiantes · Página 1 de 1",
  );
  await expect(previewRows).toHaveCount(50);
  await expect(previousPage).toBeDisabled();
  await expect(nextPage).toBeDisabled();
  await expect(previewRows.last()).toContainText("Estudiante CSV 49");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const fixture = await schoolFixture(2, false);
  await page.getByLabel("Archivo institucional").setInputFiles({
    name: "sintetico.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(fixture.file.base64, "base64"),
  });
  await expect(
    page.getByRole("heading", { name: "2 estudiantes encontrados" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Guardar en borrador" }).click();
  await expect(page.getByLabel("Grupos a asignar")).toBeVisible();
  await page.getByLabel("Grupos a asignar").selectOption({ index: 0 });
  await page
    .getByLabel("Motivo y referencia de asignación")
    .fill("Distribución confirmada del ensayo escolar");
  await page.getByRole("button", { name: "Asignar turno confirmado" }).click();
  await expect(page.getByText("Turno asignado a 2 registros.")).toBeVisible();
  await page
    .getByRole("button", { name: "Confirmar padrón revisado", exact: true })
    .click();
  await page
    .getByLabel("Referencia de revisión del padrón")
    .fill("Padrón sintético revisado para el ensayo");
  await page.getByRole("button", { name: "Confirmar incorporación" }).click();
  await expect(
    page.getByText("2 estudiantes habilitados para la elección."),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "artifacts/official-roster.png",
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Listas participantes", exact: true })
    .click();
  await page.getByRole("button", { name: "Nueva lista", exact: true }).click();
  await expect(page.getByLabel("Símbolo", { exact: true })).toHaveCount(0);
  await page.getByLabel(/Logo de la lista/).setInputFiles({
    name: "lista.png",
    mimeType: "image/png",
    buffer: logoPng(900, 200),
  });
  const preview = page.getByRole("img", {
    name: "Vista previa del logo de la lista",
  });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveJSProperty("naturalWidth", 256);
  await expect(preview).toHaveJSProperty("naturalHeight", 57);
  await page
    .getByLabel("Nombre de la lista", { exact: true })
    .fill("Lista con logo");
  await page
    .getByLabel("Nombre de candidatura", { exact: true })
    .fill("Candidata de ensayo");
  await page
    .getByRole("button", { name: "Guardar lista", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".managed-list img.list-logo")).toBeVisible();
  await page.getByRole("button", { name: "Editar lista", exact: true }).click();
  await expect(preview).toBeVisible();
  const jpegLogo = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 200;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#b91c2b";
    context.fillRect(0, 0, 900, 200);
    return canvas.toDataURL("image/jpeg");
  });
  await page.getByLabel(/Logo de la lista/).setInputFiles({
    name: "lista.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(jpegLogo.split(",")[1], "base64"),
  });
  await page
    .getByLabel("Nombre de la lista", { exact: true })
    .fill("Lista con logo revisada");
  await page
    .getByRole("button", { name: "Guardar lista", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Lista con logo revisada", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".managed-list img.list-logo")).toHaveJSProperty(
    "naturalWidth",
    256,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: "artifacts/list-logos.png", fullPage: true });
  await api(root + "/lists", {
    number: 2,
    name: "Lista 2",
    symbol: jpegLogo,
    color: "#0b1f3a",
    candidates: [{ name: "Candidata de ensayo", position: "Alcaldía" }],
    proposal: "Propuesta de ensayo",
    active: true,
  });
  await page.getByRole("link", { name: "Mesa y cabinas", exact: true }).click();
  await page.getByLabel("Nombre de la nueva cabina").fill("Cabina aula 1");
  await page.getByLabel("Responsable de mesa").selectOption(me.id);
  await page
    .getByRole("button", { name: "Registrar cabina", exact: true })
    .click();
  await page.getByRole("button", { name: "Activar en un equipo" }).click();
  await page
    .getByLabel("Motivo o comprobación realizada")
    .fill("Equipo del colegio revisado por el comité");
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  const link = page.getByLabel("Enlace privado de activación");
  await expect(link).toBeVisible();
  const cabina = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1280, height: 720 },
  });
  const voter = await cabina.newPage();
  voter.on("pageerror", (e) => errors.push(e.message));
  try {
    await voter.goto(await link.inputValue());
    await page.getByRole("button", { name: "Ocultar enlace" }).click();
    await expect(voter).toHaveURL(/\/cabina\/activar$/);
    await voter.getByRole("button", { name: "Activar este equipo" }).click();
    await expect(
      voter.getByRole("heading", { name: "Identifícate con tu DNI" }),
    ).toBeVisible();
    await api(root + "/prepare", {});
    await api(root + "/windows/MANANA/open", {
      reason: "Inicio del ensayo presencial",
    });
    await voter
      .getByLabel("Documento de identidad", { exact: true })
      .fill("10000000");
    await voter
      .getByRole("button", { name: "Solicitar verificación de mesa" })
      .click();
    await expect(
      voter.getByRole("heading", { name: "La mesa verificará tu identidad" }),
    ).toBeVisible();
    await expect(
      voter.getByText("Estudiante Sintético 0", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Verificar identidad", exact: true })
      .click();
    await page.getByLabel("DNI cotejado en el documento").fill("10000000");
    await page.getByLabel(/He comprobado presencialmente/).check();
    await page
      .getByLabel("Motivo o comprobación realizada")
      .fill("Estudiante presente, documento y datos coincidentes");
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await expect(
      voter.getByRole("heading", { name: "¿Estos son tus datos?" }),
    ).toBeVisible();
    await voter.getByRole("button", { name: "Sí, soy yo" }).click();
    await expect(
      voter.getByRole("heading", { name: "Una opción. Tu decisión." }),
    ).toBeVisible();
    expect(
      (await new AxeBuilder({ page: voter }).analyze()).violations,
    ).toEqual([]);
    await expect(voter.locator(".ballot-card img.list-logo")).toHaveCount(2);
    await expect(
      voter.locator(".ballot-card img.list-logo").first(),
    ).toBeVisible();
    await voter.getByRole("radio", { name: /Lista 1:/ }).check();
    await voter.getByRole("button", { name: /Revisar mi elección/ }).click();
    await expect(voter.locator(".review-choice img.list-logo")).toBeVisible();
    await voter.getByRole("button", { name: /Confirmar mi voto/ }).click();
    await expect(
      voter.getByRole("heading", { name: /Gracias por/ }),
    ).toBeVisible();
    await expect(
      page.getByText("No hay solicitudes pendientes."),
    ).toBeVisible();
    await page.screenshot({
      path: "artifacts/official-desk.png",
      fullPage: true,
    });
    await voter.screenshot({
      path: "artifacts/official-vote.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1366, height: 600 });
    const sidebar = page.getByRole("complementary", {
      name: "Menú de administración",
    });
    await sidebar.hover();
    await page.mouse.wheel(0, 1600);
    await expect(
      page.getByRole("button", { name: "Cerrar sesión", exact: true }),
    ).toBeInViewport();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Abrir menú" }).click();
    await page
      .getByRole("link", { name: "Seguridad de cuenta", exact: true })
      .click();
    expect(errors).toEqual([]);
  } finally {
    await cabina.close();
  }
});
