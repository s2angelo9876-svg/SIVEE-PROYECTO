import { test, expect } from "@playwright/test";
import fs from "node:fs";
test("recorrido completo: comité, ambos turnos, voto, acta y nueva simulación", async ({
  page,
  browser,
}) => {
  fs.mkdirSync("artifacts/screenshots", { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const browserErrors: string[] = [];
  page.on("pageerror", (e) => browserErrors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Tu escuela/ })).toBeVisible();
  await page.screenshot({
    path: "artifacts/screenshots/01-portada.png",
    fullPage: true,
  });
  await page.goto("/admin/login");
  await page.getByLabel("Correo electrónico").fill("comite@sivee.demo");
  await page.getByLabel("Contraseña", { exact: true }).fill("DemoSivee2026!");
  await page.getByRole("button", { name: "Ingresar al panel" }).click();
  await expect(
    page.getByRole("heading", { name: "Cada participación cuenta." }),
  ).toBeVisible();
  // Start a separate simulation if a previous run already advanced the default fixture.
  const data = await page.evaluate(async () => {
    const r = await fetch("/api/v1/admin/elections");
    return (await r.json()).data;
  });
  let active = data.find((e: any) => e.state !== "ANULADA");
  if (active.state !== "BORRADOR") {
    active = await page.evaluate(async (id: string) => {
      const me = (await (await fetch("/api/v1/admin/me")).json()).data;
      const r = await fetch("/api/v1/admin/demo/" + id + "/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": me.csrfToken,
        },
        body: JSON.stringify({ confirmation: "NUEVA SIMULACION" }),
      });
      return (await r.json()).data;
    }, active.id);
    await page.reload();
  }
  await page.getByRole("link", { name: "Configuración", exact: true }).click();
  await page
    .getByRole("button", { name: "Preparar elección", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmar", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("link", { name: "Jornada electoral", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Abrir turno", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Motivo de la operación")
    .fill("Apertura para la simulación de presentación");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmar acción" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Pausar", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Vista general", exact: true }).click();
  await expect(
    page.getByText("Electores habilitados", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/screenshots/02-panel-jornada.png",
    fullPage: true,
  });
  const voterContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const voter = await voterContext.newPage();
  voter.on("pageerror", (e) => browserErrors.push(e.message));
  async function vote(dni: string, code: string, choice: string | RegExp) {
    await voter.goto("/votar");
    await voter.getByLabel("Documento de identidad", { exact: true }).fill(dni);
    await voter.getByLabel("Código individual de acceso").fill(code);
    await voter.getByRole("button", { name: "Verificar mi identidad" }).click();
    await expect(
      voter.getByRole("heading", { name: "¿Estos son tus datos?" }),
    ).toBeVisible();
    await voter.getByRole("button", { name: "Sí, soy yo" }).click();
    await expect(
      voter.getByRole("heading", { name: "Una opción. Tu decisión." }),
    ).toBeVisible();
    await voter.screenshot({
      path: "artifacts/screenshots/03-cedula.png",
      fullPage: true,
    });
    await voter.getByRole("radio", { name: choice }).check();
    await voter.getByRole("button", { name: "Revisar mi elección" }).click();
    await expect(
      voter.getByRole("heading", { name: "Revisa tu elección" }),
    ).toBeVisible();
    await voter.getByRole("button", { name: "Confirmar mi voto" }).click();
    await expect(
      voter.getByRole("heading", { name: /Gracias por/ }),
    ).toBeVisible();
    await voter.screenshot({
      path: "artifacts/screenshots/04-constancia.png",
      fullPage: true,
    });
    expect(await voter.locator("body").innerText()).not.toContain(
      "Juntos por el cambio",
    );
  }
  await vote("00000001", "DEMOCODE-001", "Lista 1: Juntos por el cambio");
  await voter.goto("/votar");
  await voter
    .getByLabel("Documento de identidad", { exact: true })
    .fill("00000001");
  await voter.getByLabel("Código individual de acceso").fill("DEMOCODE-001");
  await voter.getByRole("button", { name: "Verificar mi identidad" }).click();
  await expect(
    voter.getByRole("heading", { name: /Gracias por/ }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Resultados y actas", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Cada voto merece su momento." }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Jornada electoral", exact: true })
    .click();
  async function windowAction(name: string, index = 0) {
    await page.getByRole("button", { name, exact: true }).nth(index).click();
    await page
      .getByLabel("Motivo de la operación")
      .fill("Cambio de etapa en simulación controlada");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirmar acción" })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await windowAction("Cerrar turno");
  await windowAction("Abrir turno");
  await vote("00000026", "DEMOCODE-026", /Voto en blanco/);
  await windowAction("Cerrar turno");
  await windowAction("Solicitar cierre");
  await page
    .getByRole("button", { name: "Aprobar cierre", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmar acción" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Conciliar elección" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmar acción" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await windowAction("Solicitar publicación");
  await page.getByRole("button", { name: "Aprobar publicación" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmar acción" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("link", { name: "Resultados y actas", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Resultados por lista" }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/screenshots/05-resultados.png",
    fullPage: true,
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Acta PDF" }).click();
  await (await download).saveAs("artifacts/acta-demostracion.pdf");
  await page.getByRole("link", { name: "Auditoría", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Publicación autorizada" }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/screenshots/06-auditoria.png",
    fullPage: true,
  });
  // Preserve the completed presentation and leave a fresh, open demo for the user.
  await page.getByRole("link", { name: "Configuración", exact: true }).click();
  await page
    .getByRole("button", { name: "Nueva simulación", exact: true })
    .click();
  await page.getByLabel("Escribe NUEVA SIMULACION").fill("NUEVA SIMULACION");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmar", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Preparar elección", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmar", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("link", { name: "Jornada electoral", exact: true })
    .click();
  await windowAction("Abrir turno");
  await voterContext.close();
  expect(browserErrors).toEqual([]);
});
test("pantallas móviles de 320 y 390 px sin desplazamiento horizontal", async ({
  page,
}) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ["/", "/votar", "/admin/login"]) {
      await page.goto(path);
      await page.waitForTimeout(150);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    await page.goto("/");
    await page.screenshot({
      path: `artifacts/screenshots/07-movil-${width}.png`,
      fullPage: true,
    });
  }
});
