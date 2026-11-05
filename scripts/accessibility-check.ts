import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const results = [];
try {
  for (const route of ["/", "/votar", "/admin/login", "/admin"]) {
    await page.goto("http://localhost:5173" + route);
    if (route === "/admin") {
      await page.goto("http://localhost:5173/admin/login");
      await page.getByLabel("Correo electrónico").fill("comite@sivee.demo");
      await page
        .getByLabel("Contraseña", { exact: true })
        .fill("DemoSivee2026!");
      await page.getByRole("button", { name: "Ingresar al panel" }).click();
      await page
        .getByRole("heading", { name: "Cada participación cuenta." })
        .waitFor();
    }
    await page.waitForTimeout(500);
    const r = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    results.push({
      route,
      violations: r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    });
  }
  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync(
    "artifacts/accessibility-results.json",
    JSON.stringify({ executedAt: new Date().toISOString(), results }, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
  if (results.some((r) => r.violations.length)) process.exitCode = 1;
} finally {
  await browser.close();
}
