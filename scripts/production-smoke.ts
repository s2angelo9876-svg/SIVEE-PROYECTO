import "dotenv/config";
import { spawn } from "node:child_process";
import fs from "node:fs";
const origin = "http://localhost:5050";
async function cycle() {
  const child = spawn(process.execPath, ["dist/api/main.js"], {
    env: { ...process.env, PORT: "5050", WEB_ORIGIN: origin },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try {
        const r = await fetch(origin + "/api/v1/health/ready");
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {
        /* waiting for startup */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!ready) throw new Error("No inició la compilación de producción.");
    const html = await (await fetch(origin)).text();
    if (!html.includes("SIVEE")) throw new Error("Frontend no servido.");
    const auth = await fetch(origin + "/api/v1/admin/auth/login", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "comite@sivee.demo",
        password: "DemoSivee2026!",
      }),
    });
    if (!auth.ok) throw new Error("Login de producción falló.");
    const cookie = auth.headers.get("set-cookie")!.split(";")[0];
    const e = await (
      await fetch(origin + "/api/v1/admin/elections", {
        headers: { Cookie: cookie },
      })
    ).json();
    return e.data.map((x: any) => ({ id: x.id, state: x.state }));
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  }
}
const a = await cycle();
const b = await cycle();
if (JSON.stringify(a) !== JSON.stringify(b))
  throw new Error("Cambió el estado tras reiniciar.");
fs.mkdirSync("artifacts", { recursive: true });
const result = {
  executedAt: new Date().toISOString(),
  builtAppServesWeb: true,
  login: true,
  restartPreservesElections: true,
  elections: a.length,
};
fs.writeFileSync(
  "artifacts/production-smoke.json",
  JSON.stringify(result, null, 2),
);
console.log(result);
