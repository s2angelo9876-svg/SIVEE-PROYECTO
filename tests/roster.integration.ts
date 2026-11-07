import "dotenv/config";
import pg from "pg";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import ExcelJS from "exceljs";

const ownerUrl = new URL(process.env.MIGRATION_DATABASE_URL!),
  appUrl = new URL(process.env.DATABASE_URL!);
const name = "sivee_test_roster" + crypto.randomBytes(4).toString("hex");
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
let db: any, server: any, connection: pg.Client | undefined;
const evidence: { test: string; passed: boolean }[] = [];
try {
  for (const script of ["scripts/migrate.ts", "apps/api/prisma/seed-demo.ts"])
    execFileSync(process.execPath, ["--import", "tsx", script], {
      stdio: "pipe",
      env: process.env,
    });
  ({ db } = await import("../apps/api/src/db.js"));
  const { app } = await import("../apps/api/src/app.js");
  const { hashSecret, newToken, csrfFor, dniLookup } = await import(
    "../apps/api/src/security.js"
  );
  connection = new pg.Client({ connectionString: ownerUrl.toString() });
  await connection.connect();
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
    const json = r.headers.get("content-type")?.includes("json");
    return {
      status: r.status,
      data: json ? await r.json() : Buffer.from(await r.arrayBuffer()),
      cookie: r.headers.get("set-cookie")?.split(";")[0] || "",
    };
  }
  async function login(email: string) {
    const r = await req("/admin/auth/login", "POST", {
      email,
      password: "DemoSivee2026!",
    });
    assert.equal(r.status, 200);
    return { cookie: r.cookie, csrf: r.data.data.csrfToken };
  }
  const committee = await login("comite@sivee.demo"),
    observer = await login("observador@sivee.demo");
  const original = (await req("/admin/elections", "GET", undefined, committee))
    .data.data[0];
  const created = await req(
    "/admin/elections",
    "POST",
    {
      name: "Validación del padrón 2027",
      authMode: "CODE",
      year: 2027,
      scope: "Municipio escolar",
      blankAllowed: true,
      nullAllowed: true,
      regulation: "Reglamento de prueba",
      contact: "Mesa de pruebas",
      shifts: ["MANANA", "TARDE"],
    },
    committee,
  );
  assert.equal(created.status, 201);
  const id = created.data.data.id,
    route = "/admin/elections/" + id;
  const call = (
    suffix: string,
    body?: unknown,
    method = body ? "POST" : "GET",
    s = committee,
  ) => req(route + suffix, method, body, s);
  async function ok(
    suffix: string,
    body?: unknown,
    method = body ? "POST" : "GET",
  ) {
    const r = await call(suffix, body, method);
    assert.ok(
      r.status >= 200 && r.status < 300,
      `${suffix}: ${r.status} ${JSON.stringify(r.data)}`,
    );
    return r.data.data;
  }
  async function check(test: string, fn: () => Promise<void>) {
    await fn();
    evidence.push({ test, passed: true });
    console.log("PASS", test);
  }
  const row = (dni: string) => ({
    dni,
    apellidos_nombres: "Estudiante de prueba " + dni.slice(-2),
    grado: "3",
    seccion: "A",
    turno: "MANANA",
    habilitado: "true",
  });
  const header = "dni,apellidos_nombres,grado,seccion,turno,habilitado";
  const csv = (ids: string[]) =>
    header + "\n" + ids.map((n) => Object.values(row(n)).join(",")).join("\n");
  const book = new ExcelJS.Workbook();
  book.addWorksheet("Notas").addRow(["Elige la hoja Electores"]);
  const sheet = book.addWorksheet("Electores");
  sheet.addRow(header.split(","));
  sheet.addRow(Object.values(row("00010101")));
  sheet.addRow(Object.values(row("00010102")));
  const excel = {
    file: {
      name: "padron.xlsx",
      base64: Buffer.from(await book.xlsx.writeBuffer()).toString("base64"),
    },
    sheet: "Electores",
    requestId: crypto.randomUUID(),
  };
  let imported: any, firstStudent: string, code1: string;
  await check(
    "Plantilla e inspección Excel requieren permisos y reconocen hojas",
    async () => {
      assert.equal(
        (await call("/roster/template.xlsx", undefined, "GET", observer))
          .status,
        403,
      );
      assert.equal((await call("/roster/template.xlsx")).status, 200);
      const inspected = await ok("/roster/file-inspect", excel);
      assert.equal(inspected.sheets.length, 2);
      assert.equal(inspected.mapping.dni, 0);
      assert.equal(
        (await call("/roster/import-commit", excel, "POST", observer)).status,
        403,
      );
    },
  );
  await check(
    "Vista previa conserva filas y cuenta estudiantes, no cantidad de errores",
    async () => {
      const r = await ok("/roster/import-preview", {
        csv:
          header +
          "\nbad,Ana Demo,9,A,MANANA,true\n\n00010109,Nueva Persona,3,A,MANANA,true\n00000001,Nombre distinto,3,A,TARDE,true",
      });
      assert.equal(r.total, 3);
      assert.equal(r.valid, 1);
      assert.equal(r.invalid, 2);
      assert.equal(r.newCount, 1);
      assert.ok(r.errors.some((e: any) => e.row === 5));
      assert.equal(r.preview[0].row, 4);
      assert.equal(
        await db.participation.count({ where: { electionId: id } }),
        0,
      );
    },
  );
  await check(
    "Carga Excel atómica y repetición tras respuesta perdida sin duplicados",
    async () => {
      imported = await ok("/roster/import-commit", excel);
      assert.equal(imported.count, 2);
      firstStudent = imported.credentials[0].studentId;
      code1 = imported.credentials[0].accessCode;
      const again = await ok("/roster/import-commit", excel);
      assert.equal(again.alreadyImported, true);
      assert.equal(again.batchId, imported.batchId);
      assert.equal(again.credentials.length, 0);
      assert.equal(
        await db.participation.count({ where: { electionId: id } }),
        2,
      );
      assert.equal(
        (
          await call("/roster/import-commit", {
            individual: row("00010103"),
            requestId: excel.requestId,
          })
        ).status,
        409,
      );
    },
  );
  await check(
    "Reimportación distingue registros idénticos y nunca sobrescribe conflictos",
    async () => {
      const payload = {
        csv: csv(["00010101", "00010102", "00010103"]),
        skipExisting: true,
        requestId: crypto.randomUUID(),
      };
      const p = await ok("/roster/import-preview", payload);
      assert.equal(p.skipped, 2);
      assert.equal(p.newCount, 1);
      const c = await ok("/roster/import-commit", payload);
      assert.equal(c.count, 1);
      const conflict = await ok("/roster/import-preview", {
        individual: { ...row("00010101"), grado: "4" },
        skipExisting: true,
      });
      assert.equal(conflict.invalid, 1);
      assert.equal(
        (await call("/roster/import-commit", { csv: csv(["00010101"]) }))
          .status,
        409,
      );
    },
  );
  await check(
    "Una fila inválida impide guardar también las válidas",
    async () => {
      const before = await db.participation.count({
        where: { electionId: id },
      });
      const result = await call("/roster/import-commit", {
        csv: csv(["00010150"]) + "\ninvalid,Ana Demo,3,A,MANANA,true",
      });
      assert.equal(result.status, 400);
      assert.equal(
        await db.participation.count({ where: { electionId: id } }),
        before,
      );
    },
  );
  await check(
    "Registro individual concurrente crea una sola inscripción",
    async () => {
      const results = await Promise.all([
        call("/roster/import-commit", {
          individual: row("00010104"),
          requestId: crypto.randomUUID(),
        }),
        call("/roster/import-commit", {
          individual: row("00010104"),
          requestId: crypto.randomUUID(),
        }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      assert.equal(
        await db.participation.count({ where: { electionId: id } }),
        4,
      );
    },
  );
  await check(
    "Cambio institucional explícito conserva identidad y turno de elecciones anteriores",
    async () => {
      const student = await db.student.findFirstOrThrow({
        where: { dniLookup: dniLookup("00000001") },
      });
      const old = await db.participation.findUniqueOrThrow({
        where: {
          electionId_studentId: {
            electionId: original.id,
            studentId: student.id,
          },
        },
      });
      const input = {
        individual: {
          dni: "00000001",
          apellidos_nombres: student.displayName,
          grado: "5",
          seccion: "Z",
          turno: "TARDE",
          habilitado: "true",
        },
        requestId: crypto.randomUUID(),
      };
      assert.equal((await call("/roster/import-commit", input)).status, 409);
      await ok("/roster/import-commit", {
        ...input,
        updateProfiles: true,
        reason: "Actualización de matrícula del siguiente año",
      });
      const prior = await req(
        `/admin/elections/${original.id}/roster/search`,
        "POST",
        { dni: "00000001" },
        committee,
      );
      assert.equal(prior.data.data.grade, old.grade);
      assert.equal(prior.data.data.shift, old.shift);
      const current = await ok("/roster/search", { dni: "00000001" });
      assert.equal(current.grade, "5");
      assert.equal(current.shift, "TARDE");
      const token = newToken();
      await db.voterSession.create({
        data: {
          electionId: original.id,
          studentId: student.id,
          tokenHash: hashSecret(token),
          expiresAt: new Date(Date.now() + 300000),
        },
      });
      const me = await req("/voter/me", "GET", undefined, {
        cookie: "sivee_voter=" + token,
        csrf: csrfFor(token),
      });
      assert.equal(me.data.data.student.grade, old.grade);
      assert.equal(me.data.data.student.shift, old.shift);
    },
  );
  await check(
    "Códigos amplían vigencia al programar una jornada lejana",
    async () => {
      const end = new Date(Date.now() + 120 * 86400000).toISOString();
      await ok("/windows/MANANA", { startsAt: null, endsAt: end }, "PATCH");
      const c = await db.credential.findUniqueOrThrow({
        where: {
          electionId_studentId: { electionId: id, studentId: firstStudent },
        },
      });
      assert.ok(+c.expiresAt > Date.parse(end));
      const fresh = await ok("/roster/import-commit", {
        individual: row("00010105"),
        requestId: crypto.randomUUID(),
      });
      assert.ok(Date.parse(fresh.credentials[0].expiresAt) > Date.parse(end));
    },
  );
  await check(
    "Historial recuperable sin códigos ni DNI y reemisión autorizada por lote",
    async () => {
      const history = await ok("/roster/imports");
      assert.ok(history.some((b: any) => b.batchId === imported.batchId));
      assert.ok(!JSON.stringify(history).includes(code1));
      assert.ok(!JSON.stringify(history).includes("00010101"));
      assert.equal(
        (
          await call("/roster/reissue", {
            batchId: imported.batchId,
            reason: "corto",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await call(
            "/roster/reissue",
            {
              batchId: imported.batchId,
              reason: "Recuperación de entrega perdida",
            },
            "POST",
            observer,
          )
        ).status,
        403,
      );
      const renewed = await ok("/roster/reissue", {
        batchId: imported.batchId,
        reason: "Descarga perdida al interrumpirse la red",
      });
      assert.equal(renewed.count, 2);
      assert.notEqual(renewed.credentials[0].accessCode, code1);
      imported = renewed;
      code1 = renewed.credentials.find(
        (c: any) => c.studentId === firstStudent,
      ).accessCode;
      await assert.rejects(() =>
        db.rosterImport.updateMany({
          where: { electionId: id },
          data: { source: "Modificado" },
        }),
      );
      const audit = await db.audit.findFirst({
        where: { electionId: id, action: "CREDENTIALS_REISSUED" },
      });
      assert.ok(audit.detail.reason);
      assert.ok(!JSON.stringify(audit).includes(code1));
    },
  );
  await check(
    "Otra institución no puede consultar lotes ni reemitir",
    async () => {
      const inst = await db.institution.create({
        data: { code: "OTRA-" + crypto.randomUUID(), name: "Otra institución" },
      });
      const other = await db.election.create({
        data: { institutionId: inst.id, name: "Otra elección" },
      });
      assert.equal(
        (
          await req(
            `/admin/elections/${other.id}/roster/imports`,
            "GET",
            undefined,
            committee,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await req(
            `/admin/elections/${other.id}/roster/reissue`,
            "POST",
            { studentId: firstStudent, reason: "Intento en otra institución" },
            committee,
          )
        ).status,
        404,
      );
    },
  );
  for (let number = 1; number <= 2; number++)
    await ok("/lists", {
      number,
      name: "Lista de prueba " + number,
      symbol: "sprout",
      color: "#167568",
      candidates: [{ name: "Candidata Ejemplo", position: "Alcaldía" }],
      proposal: "",
      active: true,
    });
  await ok("/prepare", {});
  await check(
    "Después de preparar no admite altas ni reemisiones masivas",
    async () => {
      assert.equal(
        (await call("/roster/import-commit", { individual: row("00010188") }))
          .status,
        409,
      );
      assert.equal(
        (
          await call("/roster/reissue", {
            batchId: excel.requestId,
            reason: "Intento de reemisión masiva",
          })
        ).status,
        409,
      );
    },
  );
  await ok("/windows/MANANA/open", {
    reason: "Apertura para pruebas del padrón",
  });
  async function voterLogin(dni: string, code: string) {
    return req("/voter/sessions", "POST", {
      electionId: id,
      dni,
      accessCode: code,
    });
  }
  let session: Session;
  await check(
    "Reemisión individual revoca sesiones y el código anterior sin cambiar participación",
    async () => {
      const login = await voterLogin("00010101", code1);
      assert.equal(login.status, 200);
      session = { cookie: login.cookie, csrf: login.data.data.csrfToken };
      const renewed = await ok("/roster/reissue", {
        studentId: firstStudent,
        reason: "Titular verificado: pérdida del código",
      });
      assert.equal(
        (await req("/voter/status", "GET", undefined, session)).status,
        401,
      );
      assert.equal((await voterLogin("00010101", code1)).status, 401);
      code1 = renewed.credentials[0].accessCode;
      const current = await voterLogin("00010101", code1);
      assert.equal(current.status, 200);
      session = { cookie: current.cookie, csrf: current.data.data.csrfToken };
      assert.equal(
        (await ok("/roster/search", { dni: "00010101" })).state,
        "PENDIENTE",
      );
    },
  );
  async function queued(fragment: string, minimum = 1) {
    for (let i = 0; i < 100; i++) {
      const r = await owner.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock' AND query LIKE $2",
        [name, "%" + fragment + "%"],
      );
      if (r.rows[0].n >= minimum) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(
      "La operación no llegó a la barrera de concurrencia: " + fragment,
    );
  }
  await check(
    "Dos reemisiones simultáneas no entregan dos códigos distintos como vigentes",
    async () => {
      await connection!.query("BEGIN");
      await connection!.query(
        "SELECT id FROM elections WHERE id=$1 FOR UPDATE",
        [id],
      );
      const attempts = [
        call("/roster/reissue", {
          studentId: firstStudent,
          reason: "Solicitud simultánea del primer operador",
        }),
        call("/roster/reissue", {
          studentId: firstStudent,
          reason: "Solicitud simultánea del segundo operador",
        }),
      ];
      try {
        await queued("FOR UPDATE", 2);
      } finally {
        await connection!.query("COMMIT");
      }
      const results = await Promise.all(attempts);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      code1 = results.find((r) => r.status === 200)!.data.data.credentials[0]
        .accessCode;
      const login = await voterLogin("00010101", code1);
      assert.equal(login.status, 200);
      session = { cookie: login.cookie, csrf: login.data.data.csrfToken };
    },
  );
  await check(
    "Voto en espera no usa una sesión revocada por reemisión concurrente",
    async () => {
      await connection!.query("BEGIN");
      await connection!.query(
        "SELECT id FROM elections WHERE id=$1 FOR UPDATE",
        [id],
      );
      let rotating: ReturnType<typeof call> | undefined,
        voting: ReturnType<typeof req> | undefined;
      try {
        rotating = call("/roster/reissue", {
          studentId: firstStudent,
          reason: "Prueba de reemisión concurrente autorizada",
        });
        await queued("FOR UPDATE");
        voting = req(
          "/voter/votes",
          "POST",
          { electionId: id, kind: "BLANCO" },
          session!,
        );
        await queued("FOR SHARE");
      } finally {
        await connection!.query("COMMIT");
      }
      const [rotation, vote] = await Promise.all([rotating!, voting!]);
      assert.equal(rotation.status, 200);
      assert.equal(vote.status, 401);
      code1 = rotation.data.data.credentials[0].accessCode;
      assert.equal(await db.ballot.count({ where: { electionId: id } }), 0);
    },
  );
  await check(
    "Login en espera no acepta un código reemplazado concurrentemente",
    async () => {
      await connection!.query("BEGIN");
      await connection!.query(
        "SELECT id FROM elections WHERE id=$1 FOR UPDATE",
        [id],
      );
      let rotating: ReturnType<typeof call> | undefined,
        logging: ReturnType<typeof req> | undefined;
      try {
        rotating = call("/roster/reissue", {
          studentId: firstStudent,
          reason: "Prueba de cierre de acceso anterior",
        });
        await queued("FOR UPDATE");
        logging = voterLogin("00010101", code1);
        await queued("FOR SHARE");
      } finally {
        await connection!.query("COMMIT");
      }
      const [rotation, login] = await Promise.all([rotating!, logging!]);
      assert.equal(rotation.status, 200);
      assert.equal(login.status, 401);
      code1 = rotation.data.data.credentials[0].accessCode;
    },
  );
  await check(
    "Después de votar o cerrar el turno no permite reemitir",
    async () => {
      const login = await voterLogin("00010101", code1);
      assert.equal(login.status, 200);
      const s = { cookie: login.cookie, csrf: login.data.data.csrfToken };
      assert.equal(
        (
          await req(
            "/voter/votes",
            "POST",
            { electionId: id, kind: "BLANCO" },
            s,
          )
        ).status,
        201,
      );
      assert.equal(
        (
          await call("/roster/reissue", {
            studentId: firstStudent,
            reason: "No debe permitir otro voto",
          })
        ).status,
        409,
      );
      await ok("/windows/MANANA/close", {
        reason: "Cierre del turno para prueba",
      });
      const second = await ok("/roster/search", { dni: "00010102" });
      assert.equal(
        (
          await call("/roster/reissue", {
            studentId: second.id,
            reason: "Turno cerrado definitivamente",
          })
        ).status,
        409,
      );
      assert.equal(await db.ballot.count({ where: { electionId: id } }), 1);
    },
  );
  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync(
    "artifacts/roster-integration-results.json",
    JSON.stringify(
      { executedAt: new Date().toISOString(), checks: evidence },
      null,
      2,
    ),
  );
  console.log(`Padrón: ${evidence.length} comprobaciones aprobadas.`);
} finally {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  if (db) await db.$disconnect();
  if (connection) await connection.end();
  await owner.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await owner.end();
}
