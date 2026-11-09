import "dotenv/config";
import pg from "pg";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { schoolFixture } from "./school-fixture.js";
import { logoData, logoPng } from "./list-logo.fixture.js";
const ownerUrl = new URL(process.env.MIGRATION_DATABASE_URL!),
  appUrl = new URL(process.env.DATABASE_URL!);
const name = "sivee_test_official" + crypto.randomBytes(4).toString("hex");
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
  const { config } = await import("../apps/api/src/config.js");
  const { totp } = await import("../apps/api/src/mfa.js");
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
    observer = await login("observador@sivee.demo");
  async function check(label: string, test: () => Promise<void>) {
    await test();
    passed++;
    console.log("PASS", label);
  }
  const e = success(
    await req(
      "/admin/elections",
      "POST",
      {
        name: "Elección presencial sintética",
        year: 2027,
        scope: "Municipio escolar",
        blankAllowed: true,
        nullAllowed: true,
        regulation: "Reglamento para validación automatizada",
        contact: "Mesa de validación",
        shifts: ["MANANA", "TARDE"],
      },
      committee,
    ),
  );
  assert.equal(e.authMode, "DESK");
  const root = `/admin/elections/${e.id}`;
  const call = (
    suffix: string,
    body?: unknown,
    method = body ? "POST" : "GET",
    s = committee,
  ) => req(root + suffix, method, body, s);
  const school = "/roster/school";
  let rows: any[];
  const fixture = await schoolFixture();
  await check(
    "Archivo 1742: permisos, cifrado, máscara, repetición idempotente y bloqueo de pendientes",
    async () => {
      assert.equal(
        (await call(school + "/import", fixture, "POST", observer)).status,
        403,
      );
      const preview = success(await call(school + "/preview", fixture));
      assert.equal(preview.total, 1742);
      assert.equal(preview.pending, 27);
      assert.equal(preview.rows.length, 1742);
      assert.equal(preview.rows[1741].displayName, "Estudiante Sintético 1741");
      assert.equal(preview.rows[1741].document, "••••1741");
      assert.ok(preview.rows.every((r: any) => !/^\d{8}$/.test(r.document)));
      assert.equal(
        await db.schoolDraft.count({ where: { electionId: e.id } }),
        0,
      );
      assert.equal(
        success(await call(school + "/import", fixture)).count,
        1742,
      );
      assert.equal(
        success(await call(school + "/import", fixture)).alreadyImported,
        true,
      );
      const state = success(await call(school));
      rows = state.rows;
      assert.equal(rows.length, 1742);
      assert.equal(state.pending, 27);
      assert.ok(!JSON.stringify(state).includes('"document":"10000030"'));
      const stored = await db.schoolDraft.findFirstOrThrow({
        where: { electionId: e.id, studentCode: "MATRICULA-30" },
      });
      assert.ok(!stored.documentEncrypted.includes("10000030"));
      assert.equal(
        (
          await call(school + "/publish", {
            reason: "Intento con pendientes de revisión",
          })
        ).status,
        409,
      );
      await assert.rejects(() =>
        db.schoolImport.updateMany({
          where: { electionId: e.id },
          data: { source: "Alterado" },
        }),
      );
    },
  );
  await check(
    "1742 electores confirmados sin asignar turnos ni generar códigos",
    async () => {
      rows = success(await call(school)).rows;
      for (let i = 0; i < 27; i++) {
        const r = rows.find((r) => r.studentCode === "MATRICULA-" + i);
        const body = {
          studentCode: r.studentCode,
          document: String(10000000 + i),
          displayName: r.displayName,
          grade: r.grade,
          section: r.section,
          shift: r.shift,
          enrollment: r.enrollment,
          enrollmentApproved: true,
          excluded: false,
          version: r.version,
          reason: "Documento sintético cotejado por comité",
        };
        success(await call(school + "/rows/" + r.id, body, "PATCH"));
        if (i === 0)
          assert.equal(
            (await call(school + "/rows/" + r.id, body, "PATCH")).status,
            409,
          );
      }
      const start = Date.now();
      assert.equal(
        success(
          await call(school + "/publish", {
            reason: "Confirmación del padrón sintético completo",
          }),
        ).count,
        1742,
      );
      console.log("1742 electores confirmados en ms:", Date.now() - start);
      assert.equal(
        await db.credential.count({ where: { electionId: e.id } }),
        0,
      );
      assert.equal(
        await db.participation.count({ where: { electionId: e.id } }),
        1742,
      );
    },
  );
  await check(
    "Alta individual, documento duplicado y exclusión motivada antes de preparar",
    async () => {
      const individual = {
        studentCode: "INDIVIDUAL-1",
        document: "10000030",
        displayName: "Persona Adicional",
        grade: "2",
        section: "PAZ",
        shift: "MANANA",
        enrollment: "DEFINITIVA",
      };
      success(
        await call(school + "/import", {
          requestId: crypto.randomUUID(),
          individual,
        }),
      );
      const r = success(await call(school)).rows.find(
        (r: any) => r.studentCode === individual.studentCode,
      );
      assert.ok(r.issues.some((s: string) => s.includes("repetido")));
      assert.equal(
        (
          await call(school + "/publish", {
            reason: "Intento de documento duplicado",
          })
        ).status,
        409,
      );
      success(
        await call(
          school + "/rows/" + r.id,
          {
            ...individual,
            version: r.version,
            enrollmentApproved: false,
            excluded: true,
            reason: "Registro duplicado excluido por el comité",
          },
          "PATCH",
        ),
      );
      assert.equal(
        success(
          await call(school + "/publish", {
            reason: "Confirmación de exclusión del duplicado",
          }),
        ).count,
        0,
      );
    },
  );
  const uploadedLogo = logoData(logoPng(2, 2, 40000));
  const imageList = {
    number: 3,
    name: "Lista con imagen",
    symbol: uploadedLogo,
    color: "#0b1f3a",
    candidates: [{ name: "Persona Ejemplo", position: "Alcaldía" }],
    proposal: "",
    active: true,
  };
  await check(
    "Logos: carga mayor de 32 KB, edición, permisos y validación de contenido",
    async () => {
      for (let number = 1; number <= 2; number++)
        success(
          await call("/lists", {
            number,
            name: "Lista " + number,
            symbol: number === 1 ? uploadedLogo : "sprout",
            color: "#0b1f3a",
            candidates: [{ name: "Persona Candidata", position: "Alcaldía" }],
            proposal: "",
            active: true,
          }),
        );

      const lists = success(await call("/lists"));
      const first = lists.find((l: any) => l.number === 1);
      assert.equal(first.symbol, uploadedLogo);
      assert.equal(
        (await db.electoralList.findUniqueOrThrow({ where: { id: first.id } }))
          .symbol,
        uploadedLogo,
      );
      assert.equal(
        (await call("/lists", imageList, "POST", observer)).status,
        403,
      );
      for (const symbol of [
        "data:image/svg+xml;base64,PHN2Zz4=",
        logoData(Buffer.from("not an image")),
        logoData(logoPng(1025, 1)),
        logoData(logoPng(2, 2, 300000)),
      ])
        assert.equal(
          (await call("/lists", { ...imageList, symbol })).status,
          400,
        );
      success(
        await call(
          "/lists/" + first.id,
          { ...imageList, number: 1, name: first.name },
          "PATCH",
        ),
      );
      assert.equal(
        (
          await call(
            "/lists/" + first.id,
            { ...imageList, number: 1, symbol: logoData(Buffer.from("bad")) },
            "PATCH",
          )
        ).status,
        400,
      );
      assert.equal(
        success(await call("/lists")).find((l: any) => l.id === first.id)
          .symbol,
        uploadedLogo,
      );
    },
  );
  const dniResponse = (dni: string) =>
    req("/voter/dni-sessions", "POST", { electionId: e.id, dni });
  async function enterDni(dni: string): Promise<Session> {
    const response = await dniResponse(dni),
      data = success(response);
    assert.equal(response.cookies.length, 1);
    assert.ok(response.cookies[0].startsWith("sivee_voter="));
    return { cookie: response.cookies[0], csrf: data.csrfToken };
  }
  await check(
    "Preparación sin cabinas ni responsables; horario cerrado impide entrar",
    async () => {
      assert.equal(await db.booth.count({ where: { electionId: e.id } }), 0);
      assert.equal((await dniResponse("10000030")).status, 409);
      success(
        await call(school + "/import", {
          requestId: crypto.randomUUID(),
          individual: {
            studentCode: "TARDE-PRUEBA",
            document: "20000002",
            displayName: "Estudiante del turno tarde",
            grade: "2",
            section: "PAZ",
            shift: "TARDE",
            enrollment: "DEFINITIVA",
          },
        }),
      );
      success(
        await call(school + "/publish", {
          reason: "Confirmación de estudiante del turno tarde",
        }),
      );
      success(await call("/prepare", {}));
      const frozenList = success(await call("/lists")).find(
        (l: any) => l.number === 1,
      );
      assert.equal(
        (
          await call(
            "/lists/" + frozenList.id,
            { ...imageList, number: 1 },
            "PATCH",
          )
        ).status,
        409,
      );
      assert.equal((await call(school + "/import", fixture)).status, 409);
      success(
        await call("/windows/MANANA/open", {
          reason: "Inicio del ensayo sin activación de equipos",
        }),
      );
      success(await dniResponse("20000002"));
      assert.equal((await req("/booth/status")).status, 404);
      assert.equal(
        (await call("/desk/booths", { name: "Sin cabinas" })).status,
        404,
      );
    },
  );
  let voter: Session;
  await check(
    "Solo DNI desde un navegador nuevo, sin cookies de cabina ni sesión administrativa",
    async () => {
      voter = await enterDni("10000030");
      const identity = success(await req("/voter/me", "GET", undefined, voter));
      assert.equal(identity.student.displayName, "Estudiante Sintético 30");
      const ballot = success(
        await req("/voter/ballot", "GET", undefined, voter),
      );
      assert.equal(
        ballot.lists.find((l: any) => l.number === 1).symbol,
        uploadedLogo,
      );
      assert.equal(
        await db.admission.count({ where: { electionId: e.id } }),
        0,
      );
      const event = await db.audit.findFirstOrThrow({
        where: { electionId: e.id, action: "DNI_SESSION_CREATED" },
      });
      assert.equal(event.adminId, null);
      assert.ok(!JSON.stringify(event.detail).includes("10000030"));
      assert.equal(
        await db.audit.count({
          where: { electionId: e.id, action: "IDENTITY_VERIFIED" },
        }),
        0,
      );
    },
  );
  await check(
    "DNI inválido, desconocido, estudiante inactivo y autenticación sin sesión se rechazan",
    async () => {
      assert.equal((await dniResponse("bad")).status, 400);
      assert.equal((await dniResponse("19999999")).status, 403);
      assert.equal((await req("/voter/me")).status, 401);
      const student = await db.participation.findFirstOrThrow({
        where: { electionId: e.id, displayName: "Estudiante Sintético 34" },
      });
      await db.student.update({
        where: { id: student.studentId },
        data: { active: false },
      });
      assert.equal((await dniResponse("10000034")).status, 403);
      await db.student.update({
        where: { id: student.studentId },
        data: { active: true },
      });
      assert.equal(
        (
          await req("/voter/sessions", "POST", {
            electionId: e.id,
            dni: "10000034",
            accessCode: "CUALQUIER-CODIGO",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await req("/voter/dni-sessions", "POST", {
            electionId: e.id,
            dni: "10000034",
            approved: true,
          })
        ).status,
        400,
      );
      const simulation = await db.election.findFirstOrThrow({
        where: { authMode: "CODE" },
      });
      assert.equal(
        (
          await req("/voter/dni-sessions", "POST", {
            electionId: simulation.id,
            dni: "10000034",
          })
        ).status,
        403,
      );
    },
  );
  await check(
    "Pausa bloquea accesos y votos; doble envío concurrente produce una sola papeleta",
    async () => {
      success(
        await call("/windows/MANANA/pause", {
          reason: "Pausa del ensayo de acceso directo",
        }),
      );
      const vote = () =>
        req(
          "/voter/votes",
          "POST",
          { electionId: e.id, kind: "BLANCO" },
          voter,
        );
      assert.equal((await vote()).status, 409);
      assert.equal((await dniResponse("10000034")).status, 409);
      success(
        await call("/windows/MANANA/open", {
          reason: "Reanudación del ensayo de acceso directo",
        }),
      );
      const responses = await Promise.all([vote(), vote()]);
      responses.forEach(success);
      assert.equal(await db.ballot.count({ where: { electionId: e.id } }), 1);
      assert.equal(
        await db.participation.count({
          where: { electionId: e.id, state: "VOTO_EMITIDO" },
        }),
        1,
      );
      assert.equal((await dniResponse("10000030")).status, 403);
    },
  );
  await check(
    "Dos accesos con el mismo DNI conservan solo la última sesión y un único voto",
    async () => {
      const responses = await Promise.all([
        dniResponse("10000031"),
        dniResponse("10000031"),
      ]);
      responses.forEach(success);
      const sessions = responses.map((r) => ({
        cookie: r.cookies[0],
        csrf: r.data.data.csrfToken,
      }));
      const identities = await Promise.all(
        sessions.map((s) => req("/voter/me", "GET", undefined, s)),
      );
      assert.deepEqual(identities.map((r) => r.status).sort(), [200, 401]);
      const current = sessions[identities.findIndex((r) => r.status === 200)];
      success(
        await req(
          "/voter/votes",
          "POST",
          { electionId: e.id, kind: "BLANCO" },
          current,
        ),
      );
      assert.equal((await dniResponse("10000031")).status, 403);
      assert.equal(await db.ballot.count({ where: { electionId: e.id } }), 2);
    },
  );
  await check(
    "Sesión caduca sin renovarse y permite volver a ingresar; sesiones antiguas exigen DNI nuevo",
    async () => {
      const current = await enterDni("10000032");
      const before = await db.voterSession.findFirstOrThrow({
        where: {
          electionId: e.id,
          revoked: false,
          student: {
            dniLookup: (await import("../apps/api/src/security.js")).dniLookup(
              "10000032",
            ),
          },
        },
      });
      success(await req("/voter/me", "GET", undefined, current));
      assert.equal(
        +(await db.voterSession.findUniqueOrThrow({ where: { id: before.id } }))
          .expiresAt,
        +before.expiresAt,
      );
      await db.voterSession.update({
        where: { id: before.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      assert.equal(
        (await req("/voter/me", "GET", undefined, current)).status,
        401,
      );
      const legacy = await enterDni("10000032");
      const admin = await db.admin.findUniqueOrThrow({
        where: { email: "comite@sivee.demo" },
      });
      const legacyBooth = await db.booth.create({
        data: {
          electionId: e.id,
          name: "Cabina histórica desactivada",
          assignedAdminId: admin.id,
          active: false,
        },
      });
      const legacyAdmission = await db.admission.create({
        data: {
          electionId: e.id,
          boothId: legacyBooth.id,
          studentId: before.studentId,
          state: "APPROVED",
          expiresAt: new Date(Date.now() + 300000),
        },
      });
      await db.voterSession.updateMany({
        where: {
          electionId: e.id,
          studentId: before.studentId,
          revoked: false,
        },
        data: { admissionId: legacyAdmission.id },
      });
      assert.equal(
        (await req("/voter/me", "GET", undefined, legacy)).status,
        401,
      );
      success(
        await req("/voter/me", "GET", undefined, await enterDni("10000032")),
      );
    },
  );
  await check(
    "CSRF, origen y elección ajenos no permiten emitir votos",
    async () => {
      const current = await enterDni("10000034");
      assert.equal(
        (
          await req(
            "/voter/votes",
            "POST",
            { electionId: e.id, kind: "BLANCO" },
            { ...current, csrf: "invalid" },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await req(
            "/voter/votes",
            "POST",
            { electionId: crypto.randomUUID(), kind: "BLANCO" },
            current,
          )
        ).status,
        401,
      );
      const response = await fetch(base + "/voter/dni-sessions", {
        method: "POST",
        headers: {
          Origin: "https://untrusted.invalid",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ electionId: e.id, dni: "10000034" }),
      });
      assert.equal(response.status, 403);
      assert.equal(await db.ballot.count({ where: { electionId: e.id } }), 2);
    },
  );
  await check(
    "Un nuevo acceso en cola revoca un voto que ya había pasado autenticación",
    async () => {
      const previous = await enterDni("10000035");
      const gate = new pg.Client({ connectionString: ownerUrl.toString() });
      await gate.connect();
      await gate.query("BEGIN");
      let entering: ReturnType<typeof dniResponse> | undefined,
        voting: ReturnType<typeof req> | undefined;
      async function queued(fragment: string) {
        for (let i = 0; i < 100; i++) {
          const result = await owner.query(
            "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock' AND query LIKE $2",
            [name, "%" + fragment + "%"],
          );
          if (result.rows[0].n > 0) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error("No llegó a la barrera: " + fragment);
      }
      try {
        await gate.query("SELECT id FROM elections WHERE id=$1 FOR UPDATE", [
          e.id,
        ]);
        entering = dniResponse("10000035");
        await queued("FOR UPDATE");
        voting = req(
          "/voter/votes",
          "POST",
          { electionId: e.id, kind: "BLANCO" },
          previous,
        );
        await queued("FOR SHARE");
      } finally {
        await gate.query("COMMIT");
        await gate.end();
      }
      success(await entering!);
      assert.equal((await voting!).status, 401);
      assert.equal(await db.ballot.count({ where: { electionId: e.id } }), 2);
    },
  );
  await check(
    "Salir cancela la sesión y permite usar otro dispositivo sin activarlo",
    async () => {
      const current = await enterDni("10000036");
      success(await req("/voter/logout", "POST", {}, current));
      assert.equal(
        (await req("/voter/me", "GET", undefined, current)).status,
        401,
      );
      success(
        await req("/voter/me", "GET", undefined, await enterDni("10000036")),
      );
    },
  );
  await check(
    "Un DNI de tarde vota en la mañana y uno de mañana en la tarde, sin asignaciones adicionales",
    async () => {
      const afternoonStudent = await enterDni("20000002");
      success(await req("/voter/ballot", "GET", undefined, afternoonStudent));
      success(
        await req(
          "/voter/votes",
          "POST",
          { electionId: e.id, kind: "BLANCO" },
          afternoonStudent,
        ),
      );
      success(
        await call("/windows/MANANA/close", {
          reason: "Finalización del primer horario del ensayo",
        }),
      );
      success(
        await call("/windows/TARDE/open", {
          reason: "Apertura del segundo horario sin restricción de turno",
        }),
      );
      const morningStudent = await enterDni("10000037");
      success(await req("/voter/ballot", "GET", undefined, morningStudent));
      success(
        await req(
          "/voter/votes",
          "POST",
          { electionId: e.id, kind: "BLANCO" },
          morningStudent,
        ),
      );
      assert.equal(await db.ballot.count({ where: { electionId: e.id } }), 4);
      success(
        await call("/windows/TARDE/pause", {
          reason: "Pausa general de todos los estudiantes",
        }),
      );
      assert.equal((await dniResponse("10000038")).status, 409);
    },
  );
  await check(
    "Escudo PNG válido se sirve con su tipo; SVG y carga sin permisos se rechazan",
    async () => {
      const base64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAE0lEQVR4nGPglrcCIoadMtpABAAQAALJsA1VQgAAAABJRU5ErkJggg==";
      assert.equal(
        (await req("/admin/institution/crest", "POST", { base64 }, observer))
          .status,
        403,
      );
      success(
        await req("/admin/institution/crest", "POST", { base64 }, committee),
      );
      assert.equal(
        success(await req("/site")).crestUrl,
        "/api/v1/branding/crest",
      );
      const response = await req("/branding/crest");
      assert.equal(response.status, 200);
      assert.deepEqual(response.data, Buffer.from(base64, "base64"));
      assert.equal(
        (
          await req(
            "/admin/institution/crest",
            "POST",
            { base64: Buffer.from("<svg></svg>").toString("base64") },
            committee,
          )
        ).status,
        409,
      );
    },
  );
  await check(
    "Producción exige MFA: primer acceso limitado, activación y rechazo sin segundo factor",
    async () => {
      config.SIVEE_ENV = "production";
      try {
        const limited = await login("observador@sivee.demo");
        assert.equal(
          (await req("/admin/elections", "GET", undefined, limited)).status,
          403,
        );
        const setup = success(
          await req(
            "/admin/mfa/setup",
            "POST",
            { password: "DemoSivee2026!" },
            limited,
          ),
        );
        success(
          await req(
            "/admin/mfa/confirm",
            "POST",
            { code: totp(setup.secret, Math.floor(Date.now() / 30000)) },
            limited,
          ),
        );
        assert.equal(
          (await req("/admin/elections", "GET", undefined, limited)).status,
          200,
        );
        assert.equal(
          (
            await req("/admin/auth/login", "POST", {
              email: "observador@sivee.demo",
              password: "DemoSivee2026!",
            })
          ).status,
          401,
        );
      } finally {
        config.SIVEE_ENV = "test";
      }
    },
  );
  console.log(`${passed} pruebas oficiales aprobadas; solo datos sintéticos.`);
} finally {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  if (db) await db.$disconnect();
  await owner.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await owner.end();
}
