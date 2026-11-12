import "dotenv/config";
import { test, expect, type Page, type Locator } from "@playwright/test";
import pg from "pg";
import crypto from "node:crypto";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";

// A separate database/server protects the presentation's existing roster and codes.
const origin = "http://localhost:5058";
test.use({ baseURL: origin, actionTimeout: 10000 });
const database =
  "sivee_test_formsbrowser" + crypto.randomBytes(4).toString("hex");
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
    PORT: "5058",
    WEB_ORIGIN: origin,
  };
  for (const script of ["scripts/migrate.ts", "apps/api/prisma/seed-demo.ts"])
    execFileSync(process.execPath, ["--import", "tsx", script], {
      env,
      stdio: "pipe",
    });
  const setup = new pg.Client({ connectionString: migration.toString() });
  await setup.connect();
  try {
    await setup.query(
      `INSERT INTO grants (id, "adminId", "electionScope", role, permissions)
      SELECT $1, id, '*', 'ADMIN_TECNICO', ARRAY['accounts:manage'] FROM admins WHERE email=$2`,
      [crypto.randomUUID(), "comite@sivee.demo"],
    );
  } finally {
    await setup.end();
  }
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
async function setup(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Correo electrónico").fill("comite@sivee.demo");
  await page.getByLabel("Contraseña", { exact: true }).fill("DemoSivee2026!");
  await page.getByRole("button", { name: "Ingresar al panel" }).click();
  await expect(page).toHaveURL(origin + "/admin");
  const me = (
    await (await page.request.get(origin + "/api/v1/admin/me")).json()
  ).data;
  const headers = { Origin: origin, "X-CSRF-Token": me.csrfToken };
  const response = await page.request.post(origin + "/api/v1/admin/elections", {
    headers,
    data: {
      name: "Ensayo de formularios " + crypto.randomBytes(3).toString("hex"),
      year: 2027,
      scope: "Municipio escolar",
      blankAllowed: true,
      nullAllowed: true,
      regulation: "Reglamento sintético de revisión de interfaz",
      contact: "Comité del ensayo",
      shifts: ["MANANA", "TARDE"],
    },
  });
  expect(response.status()).toBe(201);
  return { election: (await response.json()).data, headers };
}
async function contained(page: Page, dialog: Locator, primary: string) {
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox(),
    viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(8);
  expect(box!.y).toBeGreaterThanOrEqual(8);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width - 8);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - 8);
  const availableWidth = await page.evaluate(
    () => document.documentElement.getBoundingClientRect().width,
  );
  expect(Math.abs(box!.x + box!.width / 2 - availableWidth / 2)).toBeLessThan(
    2,
  );
  expect(Math.abs(box!.y + box!.height / 2 - viewport.height / 2)).toBeLessThan(
    2,
  );
  await expect(
    dialog.getByRole("button", { name: primary, exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(
    dialog.getByRole("button", { name: "Cancelar", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(
    dialog.getByRole("button", { name: "Cerrar diálogo", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  const footer = await dialog.locator(".modal-actions").boundingBox();
  await dialog.locator(".modal-body").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const after = await dialog.locator(".modal-actions").boundingBox();
  expect(after!.y).toBeCloseTo(footer!.y, 1);
  await expect(
    dialog.getByRole("button", { name: primary, exact: true }),
  ).toBeInViewport({ ratio: 1 });
}
test("Las confirmaciones permanecen centradas con ratón, Escape y retorno del foco", async ({
  page,
}) => {
  await setup(page);
  for (const viewport of [
    { width: 1366, height: 600 },
    { width: 1024, height: 600 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 640, height: 360 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/admin/configuracion");
    const trigger = page.getByRole("button", {
      name: "Preparar elección",
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole("dialog", {
      name: "Preparar elección",
      exact: true,
    });
    await contained(page, dialog, "Confirmar");
    if (viewport.width === 1366 || viewport.width === 390)
      await page.screenshot({
        path: `artifacts/forms-after-${viewport.width}.png`,
      });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
});
test("Los formularios largos conservan las acciones visibles en laptop, móvil y poca altura", async ({
  page,
}) => {
  const { election, headers } = await setup(page);
  const result = await page.request.post(
    origin + `/api/v1/admin/elections/${election.id}/copies`,
    {
      headers,
      data: {
        requestId: crypto.randomUUID(),
        label: "Punto guardado para comprobar la recuperación y sus acciones",
      },
    },
  );
  expect(result.status()).toBe(201);
  for (const viewport of [
    { width: 1366, height: 600 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 640, height: 360 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/admin/listas");
    await page
      .getByRole("button", { name: "Nueva lista", exact: true })
      .click();
    let dialog = page.getByRole("dialog", { name: "Nueva lista", exact: true });
    for (let i = 0; i < 6; i++)
      await dialog
        .getByRole("button", { name: "Agregar candidatura", exact: true })
        .click();
    await contained(page, dialog, "Guardar lista");
    expect(
      await dialog
        .locator(".modal-body")
        .evaluate((e) => e.scrollHeight > e.clientHeight),
    ).toBe(true);
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.goto("/admin/padron");
    await page
      .getByRole("button", { name: "Registrar estudiante", exact: true })
      .click();
    dialog = page.getByRole("dialog", {
      name: "Registrar estudiante",
      exact: true,
    });
    await contained(page, dialog, "Guardar registro");
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.goto("/admin/cuentas");
    await page
      .getByRole("button", { name: "Nueva cuenta", exact: true })
      .click();
    dialog = page.getByRole("dialog", {
      name: "Crear cuenta del personal",
      exact: true,
    });
    await contained(page, dialog, "Crear cuenta");
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.goto("/admin/incidencias");
    await page
      .getByRole("button", { name: "Registrar incidencia", exact: true })
      .click();
    dialog = page.getByRole("dialog", {
      name: "Registrar incidencia",
      exact: true,
    });
    await contained(page, dialog, "Registrar incidencia");
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.goto("/admin/configuracion");
    await page
      .getByRole("button", { name: "Guardar copia", exact: true })
      .click();
    dialog = page.getByRole("dialog", {
      name: "Guardar copia de configuración",
      exact: true,
    });
    await contained(page, dialog, "Confirmar copia");
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Recuperar como nueva elección",
        exact: true,
      })
      .click();
    dialog = page.getByRole("dialog", {
      name: "Recuperar como nueva elección",
      exact: true,
    });
    await contained(page, dialog, "Confirmar recuperación");
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  }
});
test("El pie externo respeta la validación nativa y envía el formulario una sola vez", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 650 });
  await setup(page);
  await page.goto("/admin/cuentas");
  await page.getByRole("button", { name: "Nueva cuenta", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Crear cuenta del personal",
    exact: true,
  });
  let sent = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/admin/accounts")
    )
      sent++;
  });
  await dialog.locator(".modal-body").evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  await dialog
    .getByRole("button", { name: "Crear cuenta", exact: true })
    .click();
  expect(sent).toBe(0);
  await expect(dialog.getByLabel("Nombre", { exact: true })).toBeFocused();
  await dialog
    .getByLabel("Nombre", { exact: true })
    .fill("Personal del ensayo de interfaz");
  const email =
    "forms-" + crypto.randomBytes(4).toString("hex") + "@sivee.demo";
  await dialog.getByLabel("Correo", { exact: true }).fill(email);
  await dialog
    .getByLabel("Contraseña inicial (mínimo 12 caracteres)", { exact: true })
    .fill("DemoSivee2026!");
  await dialog
    .getByRole("button", { name: "Crear cuenta", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(sent).toBe(1);
  await expect(page.getByText(email, { exact: true })).toBeVisible();
});
test("Durante el guardado se bloquea la doble confirmación y Escape no oculta la operación", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 650 });
  await setup(page);
  await page.goto("/admin/configuracion");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let sent = 0;
  await page.route("**/api/v1/admin/elections/*/copies", async (route) => {
    if (route.request().method() === "POST") {
      sent++;
      await gate;
    }
    await route.continue();
  });
  await page
    .getByRole("button", { name: "Guardar copia", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Guardar copia de configuración",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Confirmar copia", exact: true })
    .click();
  await expect(dialog).toHaveAttribute("aria-busy", "true");
  await expect(
    dialog.getByRole("button", { name: "Procesando…", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Cancelar", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Cerrar diálogo", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Enter");
  expect(sent).toBe(1);
  release();
  await expect(dialog).toHaveCount(0);
  expect(sent).toBe(1);
});
