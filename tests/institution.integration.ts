import "dotenv/config";
import pg from "pg";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const ownerUrl = new URL(process.env.MIGRATION_DATABASE_URL!),
  appUrl = new URL(process.env.DATABASE_URL!);
const name = "sivee_test_institution" + crypto.randomBytes(4).toString("hex");
const owner = new pg.Client({ connectionString: ownerUrl.toString() });
await owner.connect();
await owner.query(`CREATE DATABASE "${name}"`);
ownerUrl.pathname = "/" + name;
appUrl.pathname = "/" + name;
Object.assign(process.env, {
  MIGRATION_DATABASE_URL: ownerUrl.toString(),
  DATABASE_URL: appUrl.toString(),
  SIVEE_ENV: "test",
  ALLOW_DEMO_RESET: "false",
});
let db: any,
  server: any,
  passed = 0;
try {
  for (const script of ["scripts/migrate.ts", "apps/api/prisma/seed-demo.ts"])
    execFileSync(process.execPath, ["--import", "tsx", script], {
      stdio: "pipe",
      env: process.env,
    });
  ({ db } = await import("../apps/api/src/db.js"));
  const { app } = await import("../apps/api/src/app.js");
  server = await new Promise<any>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  type Session = { cookie: string; csrf: string };
  async function req(
    path: string,
    method = "GET",
    body?: unknown,
    session?: Session,
  ) {
    const r = await fetch(base + path, {
      method,
      headers: {
        Origin: process.env.WEB_ORIGIN!,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(session
          ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
          : {}),
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: r.status,
      data: r.headers.get("content-type")?.includes("json")
        ? await r.json()
        : Buffer.from(await r.arrayBuffer()),
      cookies: r.headers.getSetCookie().map((c) => c.split(";")[0]),
    };
  }
  const success = (r: Awaited<ReturnType<typeof req>>) => {
    assert.ok(r.status >= 200 && r.status < 300, JSON.stringify(r.data));
    return r.data.data;
  };
  async function login(email: string) {
    const r = await req("/admin/auth/login", "POST", {
      email,
      password: "DemoSivee2026!",
    });
    const data = success(r);
    return { cookie: r.cookies.join("; "), csrf: data.csrfToken };
  }
  const committee = await login("comite@sivee.demo"),
    observer = await login("observador@sivee.demo"),
    tech = await login("tecnico@sivee.demo");
  async function check(label: string, test: () => Promise<void>) {
    await test();
    passed++;
    console.log("PASS", label);
  }
  let identity: any;
  await check(
    "La identidad institucional puede configurarse antes de iniciar una elección",
    async () => {
      identity = success(
        await req("/admin/institution", "GET", undefined, committee),
      );
      assert.equal(identity.identityLocked, false);
      identity = success(
        await req(
          "/admin/institution",
          "PATCH",
          { name: "Colegio Sintético para Ensayos", code: "TEST-INSTITUTION" },
          committee,
        ),
      );
      assert.equal(identity.name, "Colegio Sintético para Ensayos");
      assert.equal(identity.identityLocked, false);
      assert.equal(
        await db.audit.count({ where: { action: "INSTITUTION_UPDATED" } }),
        1,
      );
    },
  );
  const input = { name: identity.name, code: identity.code };
  await check(
    "Guardar valores sin cambios es idempotente y no añade auditoría de modificación",
    async () => {
      const saves = await Promise.all(
        Array.from({ length: 3 }, () =>
          req("/admin/institution", "PATCH", input, committee),
        ),
      );
      saves.forEach((saved) => assert.equal(saved.status, 200));
      assert.equal(
        await db.audit.count({ where: { action: "INSTITUTION_UPDATED" } }),
        1,
      );
    },
  );
  const old = await db.election.findFirstOrThrow({
    where: { institutionId: identity.id },
  });
  const participation = await db.participation.findFirstOrThrow({
    where: { electionId: old.id },
  });
  await db.election.update({
    where: { id: old.id },
    data: { state: "EN_CURSO" },
  });
  await db.ballot.create({ data: { electionId: old.id, kind: "BLANCO" } });
  await db.participation.update({
    where: { id: participation.id },
    data: { state: "VOTO_EMITIDO" },
  });
  const draftInput = {
    name: "Nueva elección después del ensayo",
    year: 2027,
    scope: "Municipio escolar",
    blankAllowed: true,
    nullAllowed: true,
    regulation: "Reglamento sintético de la nueva elección",
    contact: "Comité sintético",
    shifts: ["MANANA", "TARDE"],
  };
  const draft = success(
    await req("/admin/elections", "POST", draftInput, committee),
  );
  for (const state of [
    "EN_CURSO",
    "PAUSADA",
    "CERRADA",
    "CONCILIADA",
    "PUBLICADA",
  ]) {
    await check(
      `Un antecedente ${state} acepta la misma institución y protege sus datos históricos`,
      async () => {
        await db.election.update({ where: { id: old.id }, data: { state } });
        assert.equal(
          success(await req("/admin/institution", "GET", undefined, committee))
            .identityLocked,
          true,
        );
        const saved = success(
          await req(
            "/admin/institution",
            "PATCH",
            { name: "  " + identity.name + "  ", code: identity.code },
            committee,
          ),
        );
        assert.equal(saved.name, identity.name);
        assert.equal(saved.code, identity.code);
        assert.equal(saved.identityLocked, true);
        for (const change of [
          { ...input, name: "Un nombre institucional diferente" },
          { ...input, code: "OTRO-CODIGO" },
        ])
          assert.equal(
            (await req("/admin/institution", "PATCH", change, committee))
              .status,
            409,
          );
        assert.equal(
          await db.audit.count({ where: { action: "INSTITUTION_UPDATED" } }),
          1,
        );
      },
    );
  }
  await check(
    "Una elección nueva guarda su configuración y horarios después de un ensayo publicado",
    async () => {
      const root = "/admin/elections/" + draft.id;
      assert.equal(
        (
          await req(
            root,
            "PATCH",
            { ...draftInput, contact: "Contacto del nuevo proceso" },
            committee,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await req(
            root + "/windows/MANANA",
            "PATCH",
            {
              startsAt: "2027-11-13T13:00:00.000Z",
              endsAt: "2027-11-13T18:00:00.000Z",
            },
            committee,
          )
        ).status,
        200,
      );
      const saved = success(await req(root, "GET", undefined, committee));
      assert.equal(saved.state, "BORRADOR");
      assert.equal(saved.contact, "Contacto del nuevo proceso");
      assert.equal(
        saved.windows.find((w: any) => w.shift === "MANANA").startsAt,
        "2027-11-13T13:00:00.000Z",
      );
    },
  );
  await check(
    "Incluso un guardado sin cambios requiere los permisos institucionales",
    async () => {
      for (const denied of [observer, tech])
        assert.equal(
          (await req("/admin/institution", "PATCH", input, denied)).status,
          403,
        );
      assert.equal(
        (
          await req(
            "/admin/institution",
            "PATCH",
            { ...input, institutionId: crypto.randomUUID() },
            committee,
          )
        ).status,
        400,
      );
    },
  );
  await check(
    "Conserva colegio, votos, participaciones y auditoría del ensayo anterior",
    async () => {
      const saved = await db.institution.findUniqueOrThrow({
        where: { id: identity.id },
      });
      assert.equal(saved.name, identity.name);
      assert.equal(saved.code, identity.code);
      assert.equal(await db.ballot.count({ where: { electionId: old.id } }), 1);
      assert.equal(
        (
          await db.participation.findUniqueOrThrow({
            where: { id: participation.id },
          })
        ).state,
        "VOTO_EMITIDO",
      );
      assert.equal(
        (await db.election.findUniqueOrThrow({ where: { id: old.id } })).state,
        "PUBLICADA",
      );
      assert.equal(
        await db.audit.count({ where: { action: "INSTITUTION_UPDATED" } }),
        1,
      );
    },
  );
  console.log(
    `${passed} comprobaciones institucionales aprobadas; solo datos sintéticos.`,
  );
} finally {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  if (db) await db.$disconnect();
  await owner.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await owner.end();
}
