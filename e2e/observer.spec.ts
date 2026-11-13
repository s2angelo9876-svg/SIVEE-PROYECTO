import "dotenv/config";
import { test, expect, request } from "@playwright/test";
import pg from "pg";
import crypto from "node:crypto";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";

// A separate database/server protects the presentation's existing roster and codes.
const origin = "http://localhost:5062";
test.use({ baseURL: origin, actionTimeout: 10000 });
const database =
  "sivee_test_observerbrowser" + crypto.randomBytes(4).toString("hex");
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
    PORT: "5062",
    WEB_ORIGIN: origin,
  };
  for (const script of ["scripts/migrate.ts", "apps/api/prisma/seed-demo.ts"])
    execFileSync(process.execPath, ["--import", "tsx", script], {
      env,
      stdio: "pipe",
    });
  const fixture = new pg.Client({ connectionString: migration.toString() });
  await fixture.connect();
  try {
    // Existing accounts must gain read access to actas without rewriting their grants.
    await fixture.query(
      `UPDATE grants SET permissions=ARRAY['elections:read','turnout:read','results:read'] WHERE role='OBSERVADOR'`,
    );
  } finally {
    await fixture.end();
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
test("El observador solo ve Vista general y accede al acta tras cerrar, conciliar y publicar", async ({
  page,
}) => {
  const requested: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/admin/"))
      requested.push(new URL(r.url()).pathname);
  });
  await page.goto("/admin/login");
  await page.getByLabel("Correo electrónico").fill("observador@sivee.demo");
  await page.getByLabel("Contraseña", { exact: true }).fill("DemoSivee2026!");
  await page.getByRole("button", { name: "Ingresar al panel" }).click();
  await expect(page).toHaveURL(origin + "/admin");
  const menu = page
    .getByRole("complementary", { name: "Menú de administración" })
    .locator("nav");
  await expect(menu.getByRole("link")).toHaveText(["Vista general"]);
  await expect(menu.getByText("Resultados y actas")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(
    page.getByRole("link", {
      name: /Padrón electoral|Transparencia en cada paso|Gestionar jornada/,
    }),
  ).toHaveCount(0);
  for (const route of [
    "jornada",
    "padron",
    "listas",
    "configuracion",
    "incidencias",
    "auditoria",
    "cuentas",
    "seguridad",
    "PADRON/",
    "%63uentas",
  ]) {
    await page.goto("/admin/" + route);
    await expect(
      page.getByRole("heading", { name: "Acceso restringido" }),
    ).toBeVisible();
    await expect(
      page.locator("main form, main input, main textarea"),
    ).toHaveCount(0);
  }
  await page.goto("/admin/resultados");
  await expect(
    page.getByRole("heading", { name: "Resultados y actas bloqueados" }),
  ).toBeVisible();
  expect(
    requested.filter((p) =>
      /\/(accounts|institution|roster|lists|incidents|audit|copies|results)(\/|$)/.test(
        p,
      ),
    ),
  ).toEqual([]);
  await page.getByRole("link", { name: "Volver a Vista general" }).click();
  const committee = await request.newContext({ baseURL: origin });
  try {
    const login = await committee.post("/api/v1/admin/auth/login", {
      data: { email: "comite@sivee.demo", password: "DemoSivee2026!" },
      headers: { Origin: origin },
    });
    expect(login.status()).toBe(200);
    const headers = {
      Origin: origin,
      "X-CSRF-Token": (await login.json()).data.csrfToken,
    };
    const election = (
      await (await committee.get("/api/v1/admin/elections")).json()
    ).data[0];
    const base = `/api/v1/admin/elections/${election.id}`;
    const post = async (path: string, data: unknown = {}) => {
      const r = await committee.post(base + path, { data, headers });
      expect(r.ok(), await r.text()).toBe(true);
      return (await r.json()).data;
    };
    await post("/prepare");
    await post("/windows/MANANA/open", {
      reason: "Apertura sintética de mañana",
    });
    await post("/windows/MANANA/close", {
      reason: "Cierre sintético de mañana",
    });
    await expect(
      page.getByText("Jornada finalizada", { exact: true }),
    ).toHaveCount(1);
    await expect(menu.getByText("Resultados y actas")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await post("/windows/TARDE/open", {
      reason: "Apertura sintética de tarde",
    });
    await post("/windows/TARDE/close", { reason: "Cierre sintético de tarde" });
    // SSE unlocks the section as soon as both shifts close, without a browser reload.
    await expect(
      menu.getByRole("link", { name: "Resultados y actas" }),
    ).toBeVisible();
    await menu.getByRole("link", { name: "Resultados y actas" }).click();
    await expect(
      page.getByText("RESULTADOS RESERVADOS", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Acta PDF" })).toHaveCount(0);
    const close = await post("/close-request", {
      reason: "Cierre global de la prueba sintética",
    });
    await post("/close-approve", { approvalId: close.id });
    await post("/reconcile");
    const publish = await post("/publish-request", {
      reason: "Publicación de la prueba sintética",
    });
    await post("/publish-approve", { approvalId: publish.id });
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Acta y datos agregados" }),
    ).toBeVisible();
    await expect(menu.getByRole("link")).toHaveText([
      "Vista general",
      "Resultados y actas",
    ]);
    for (const label of ["Acta PDF", "Agregados CSV"]) {
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: label }).click();
      expect(await (await download).failure()).toBeNull();
    }
    await expect(
      page.getByRole("main").getByRole("button", {
        name: /Publicar|Aprobar|Cerrar|Guardar|Preparar/,
      }),
    ).toHaveCount(0);
  } finally {
    await committee.dispose();
  }
});
