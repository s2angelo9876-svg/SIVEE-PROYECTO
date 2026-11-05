import "dotenv/config";
// Runs through the actual HTTP contracts; never writes vote totals directly.
if (process.env.SIVEE_ENV !== "demo")
  throw new Error("Este escenario requiere DEMO.");
const base = process.env.SCENARIO_BASE_URL || "http://localhost:5000/api/v1";
let cookie = "",
  csrf = "";
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  session = { cookie, csrf },
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      Origin: process.env.WEB_ORIGIN!,
      ...(body ? { "Content-Type": "application/json" } : {}),
      Cookie: session.cookie,
      "X-CSRF-Token": session.csrf,
      ...(path === "/voter/votes"
        ? { "Idempotency-Key": crypto.randomUUID() }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
  return {
    data: j.data,
    cookie: r.headers.get("set-cookie")?.split(";")[0] || "",
  };
}
const login = await call("/admin/auth/login", "POST", {
  email: "comite@sivee.demo",
  password: "DemoSivee2026!",
});
cookie = login.cookie;
csrf = login.data.csrfToken;
const all = (await call("/admin/elections")).data;
const prior = all.find((e: any) => e.state !== "ANULADA");
if (!prior) throw new Error("Ejecuta seed:demo primero.");
const fresh = (
  await call("/admin/demo/" + prior.id + "/reset", "POST", {
    confirmation: "NUEVA SIMULACION",
  })
).data;
const id = fresh.id;
const root = "/admin/elections/" + id;
await call(root + "/prepare", "POST", {});
const lists = (await call(root + "/lists")).data;
for (const shift of ["MANANA", "TARDE"]) {
  await call(root + "/windows/" + shift + "/open", "POST", {
    reason: "Escenario completo con datos ficticios",
  });
  for (
    let i = shift === "MANANA" ? 1 : 26;
    i <= (shift === "MANANA" ? 25 : 50);
    i++
  ) {
    const auth = await call("/voter/sessions", "POST", {
      electionId: id,
      dni: String(i).padStart(8, "0"),
      accessCode: "DEMOCODE-" + String(i).padStart(3, "0"),
    });
    const voter = { cookie: auth.cookie, csrf: auth.data.csrfToken };
    await call(
      "/voter/votes",
      "POST",
      i <= 38
        ? { electionId: id, kind: "VALIDO", listId: lists[(i - 1) % 3].id }
        : { electionId: id, kind: i <= 45 ? "BLANCO" : "NULO" },
      voter,
    );
    await call("/voter/logout", "POST", {}, voter);
  }
  await call(root + "/windows/" + shift + "/close", "POST", {
    reason: "Turno de simulación finalizado",
  });
}
const close = (
  await call(root + "/close-request", "POST", {
    reason: "Cierre del escenario de cincuenta electores",
  })
).data;
await call(root + "/close-approve", "POST", { approvalId: close.id });
await call(root + "/reconcile", "POST", {});
const publish = (
  await call(root + "/publish-request", "POST", {
    reason: "Publicación de resultados ficticios conciliados",
  })
).data;
await call(root + "/publish-approve", "POST", { approvalId: publish.id });
const result = (await call(root + "/results")).data;
console.log(
  JSON.stringify(
    {
      electionId: id,
      eligible: result.summary.eligible,
      voted: result.summary.voted,
      valid: result.summary.valid,
      blank: result.summary.blank,
      null: result.summary.null,
      reconciled: result.summary.reconciled,
    },
    null,
    2,
  ),
);
