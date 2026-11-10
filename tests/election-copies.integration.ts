import "dotenv/config";
import pg from "pg";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { schoolFixture } from "./school-fixture.js";
import { logoData, logoPng } from "./list-logo.fixture.js";
const ownerUrl = new URL(process.env.MIGRATION_DATABASE_URL!),
  appUrl = new URL(process.env.DATABASE_URL!);
const name = "sivee_test_copies" + crypto.randomBytes(4).toString("hex");
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
  const source = success(
    await req(
      "/admin/elections",
      "POST",
      {
        name: "Configuración original del ensayo",
        year: 2027,
        scope: "Municipio escolar",
        blankAllowed: true,
        nullAllowed: false,
        regulation: "Reglamento original del ensayo",
        contact: "Comité sintético",
        institutionalApprovalReference: "Acta sintética 2027",
        shifts: ["MANANA", "TARDE"],
      },
      committee,
    ),
  );
  const root = `/admin/elections/${source.id}`,
    copies = root + "/copies",
    school = root + "/roster/school";
  success(
    await req(
      root + "/windows/MANANA",
      "PATCH",
      {
        startsAt: "2027-11-13T13:00:00.000Z",
        endsAt: "2027-11-13T18:00:00.000Z",
      },
      committee,
    ),
  );
  success(
    await req(school + "/import", "POST", await schoolFixture(), committee),
  );
  const roster = success(await req(school, "GET", undefined, committee));
  success(
    await req(
      school + "/foreign-students",
      "POST",
      {
        rowIds: roster.rows
          .filter((r: any) => r.foreignCandidate)
          .map((r: any) => r.id),
        reason: "Clasificación sintética de los 25 extranjeros",
      },
      committee,
    ),
  );
  const national = await db.participation.findMany({
    where: {
      electionId: source.id,
      student: {
        dniLookup: {
          in: [
            (await import("../apps/api/src/security.js")).dniLookup("10000040"),
            (await import("../apps/api/src/security.js")).dniLookup("10000041"),
          ],
        },
      },
    },
    orderBy: { studentId: "asc" },
  });
  const disabled = national[0],
    inactive = national[1];
  success(
    await req(
      root + "/roster/" + disabled.studentId,
      "PATCH",
      { enabled: false },
      committee,
    ),
  );
  const lists: any[] = [];
  for (const number of [1, 2])
    lists.push(
      success(
        await req(
          root + "/lists",
          "POST",
          {
            number,
            name: "Lista original " + number,
            symbol: logoData(logoPng()),
            color: "#167568",
            candidates: [
              { name: "Candidatura Sintética", position: "Alcaldía" },
            ],
            proposal: "Propuesta sintética original",
            active: true,
          },
          committee,
        ),
      ),
    );
  const copyInput = {
    requestId: crypto.randomUUID(),
    label: "Lista antes del ensayo",
  };
  let copy: any;
  await check(
    "Guardar una copia cifrada exige permisos y no expone datos del padrón",
    async () => {
      assert.equal((await req(copies)).status, 401);
      for (const denied of [observer, tech])
        assert.equal(
          (await req(copies, "POST", copyInput, denied)).status,
          403,
        );
      copy = success(await req(copies, "POST", copyInput, committee));
      assert.equal(copy.summary.rows, 1742);
      assert.equal(copy.summary.eligible, 1741);
      assert.equal(copy.summary.foreign, 25);
      assert.equal(copy.summary.lists, 2);
      assert.equal(copy.payloadEncrypted, undefined);
      const stored = await db.electionCopy.findUniqueOrThrow({
        where: { id: copy.id },
      });
      assert.ok(!stored.payloadEncrypted.includes("Estudiante Sintético"));
      assert.equal(
        JSON.stringify(
          success(await req(copies, "GET", undefined, committee)),
        ).includes("documentEncrypted"),
        false,
      );
    },
  );
  await check(
    "Repetir el guardado conserva una sola copia inmutable",
    async () => {
      assert.equal(
        success(await req(copies, "POST", copyInput, committee)).id,
        copy.id,
      );
      assert.equal(
        await db.electionCopy.count({ where: { electionId: source.id } }),
        1,
      );
      await assert.rejects(
        db.electionCopy.update({
          where: { id: copy.id },
          data: { label: "Cambio prohibido" },
        }),
      );
      assert.equal(
        await db.audit.count({
          where: { electionId: source.id, action: "ELECTION_COPY_SAVED" },
        }),
        1,
      );
    },
  );
  // Changes after the checkpoint must not change what is recovered.
  success(
    await req(
      root,
      "PATCH",
      {
        name: "Nombre posterior a la copia",
        year: 2027,
        scope: "Municipio escolar",
        blankAllowed: false,
        nullAllowed: true,
        regulation: "Reglamento posterior",
        contact: "Contacto posterior",
        shifts: ["MANANA", "TARDE"],
        authMode: "DESK",
        institutionalApprovalReference: "Acta sintética posterior",
      },
      committee,
    ),
  );
  success(
    await req(
      root + "/lists/" + lists[0].id,
      "PATCH",
      {
        number: 1,
        name: "Lista modificada después",
        symbol: "sun",
        color: "#AA2222",
        candidates: [{ name: "Otra Candidatura", position: "Alcaldía" }],
        proposal: "Posterior",
        active: true,
      },
      committee,
    ),
  );
  success(
    await req(
      school + "/import",
      "POST",
      {
        requestId: crypto.randomUUID(),
        individual: {
          studentCode: "POSTERIOR",
          document: "20000000",
          displayName: "Estudiante Sintético Posterior",
          grade: "1",
          section: "RESPETO",
          enrollment: "DEFINITIVA",
        },
      },
      committee,
    ),
  );
  const sourceOwner = new pg.Client({ connectionString: ownerUrl.toString() });
  await sourceOwner.connect();
  try {
    await sourceOwner.query(
      "UPDATE elections SET mode='OFICIAL', state='EN_CURSO' WHERE id=$1",
      [source.id],
    );
    await sourceOwner.query(
      'UPDATE windows SET state=\'ABIERTA\', "startsAt"=NULL, "endsAt"=NULL WHERE "electionId"=$1 AND shift=\'MANANA\'',
      [source.id],
    );
    // Pick a known synthetic voter that wasn't disabled.
    const voterRow = await db.participation.findFirstOrThrow({
      where: {
        electionId: source.id,
        state: "PENDIENTE",
        student: {
          dniLookup: (await import("../apps/api/src/security.js")).dniLookup(
            "10000100",
          ),
        },
      },
    });
    const signed = await req("/voter/dni-sessions", "POST", {
      electionId: source.id,
      dni: "10000100",
    });
    const voterSession = {
      cookie: signed.cookies.join("; "),
      csrf: success(signed).csrfToken,
    };
    success(
      await req(
        "/voter/votes",
        "POST",
        { electionId: source.id, kind: "VALIDO", listId: lists[0].id },
        voterSession,
      ),
    );
    const recoverInput = {
      requestId: crypto.randomUUID(),
      name: "Elección recuperada del ensayo",
      confirmation: "CREAR NUEVA ELECCION",
    };
    const recoverPath = copies + "/" + copy.id + "/recover";
    await check(
      "No desplaza una jornada abierta ni crea una elección parcial",
      async () => {
        const before = await db.election.count();
        assert.equal(
          (await req(recoverPath, "POST", recoverInput, committee)).status,
          409,
        );
        assert.equal(await db.election.count(), before);
        assert.equal(await db.electionCopyRecovery.count(), 0);
      },
    );
    for (const shift of ["MANANA", "TARDE"])
      success(
        await req(
          root + "/windows/" + shift + "/close",
          "POST",
          { reason: "Cierre sintético antes de recuperar copia" },
          committee,
        ),
      );
    // Use another scoped authority so this fixture also works when the temporary
    // single-account closure exception is later disabled.
    success(
      await req(
        "/admin/accounts",
        "POST",
        {
          name: "Autoridad sintética para cerrar el ensayo",
          email: "copias-aprobador@sivee.demo",
          password: "DemoSivee2026!",
          role: "COMITE",
          electionScope: source.id,
        },
        tech,
      ),
    );
    const closingAuthority = await login("copias-aprobador@sivee.demo");
    const closure = success(
      await req(
        root + "/close-request",
        "POST",
        { reason: "Fin del ensayo de recuperación" },
        committee,
      ),
    );
    success(
      await req(
        root + "/close-approve",
        "POST",
        { approvalId: closure.id },
        closingAuthority,
      ),
    );
    // Deactivation is institution-wide and must not be undone by a configuration copy.
    await db.student.update({
      where: { id: inactive.studentId },
      data: { active: false },
    });
    await check(
      "Aislamiento institucional, confirmación y alcance de creación siguen vigentes",
      async () => {
        assert.equal(
          (
            await req(
              recoverPath,
              "POST",
              { ...recoverInput, confirmation: "incorrecta" },
              committee,
            )
          ).status,
          400,
        );
        for (const denied of [observer, tech])
          assert.equal(
            (await req(recoverPath, "POST", recoverInput, denied)).status,
            403,
          );
        const { passwordHash } = await import("../apps/api/src/security.js");
        const { rolePermissions } = await import(
          "../packages/shared/domain.js"
        );
        await db.admin.create({
          data: {
            name: "Cuenta sintética acotada",
            email: "acotada@sivee.demo",
            institutionId: source.institutionId,
            passwordHash: await passwordHash("DemoSivee2026!"),
            grants: {
              create: {
                electionScope: source.id,
                role: "COMITE",
                permissions: rolePermissions.COMITE,
              },
            },
          },
        });
        const scoped = await login("acotada@sivee.demo");
        assert.equal((await req(copies, "GET", undefined, scoped)).status, 200);
        assert.equal(
          (await req(recoverPath, "POST", recoverInput, scoped)).status,
          403,
        );
        const alien = await db.institution.create({
          data: { code: "ALIEN-COPY", name: "Institución sintética ajena" },
        });
        const alienElection = await db.election.create({
          data: {
            institutionId: alien.id,
            name: "Elección de otra institución",
            authMode: "DESK",
          },
        });
        assert.equal(
          (
            await req(
              `/admin/elections/${alienElection.id}/copies`,
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
              `/admin/elections/${alienElection.id}/copies/${copy.id}/recover`,
              "POST",
              recoverInput,
              committee,
            )
          ).status,
          404,
        );
      },
    );
    await check(
      "Una copia dañada se rechaza antes de crear la nueva elección",
      async () => {
        const stored = await db.electionCopy.findUniqueOrThrow({
          where: { id: copy.id },
        });
        const damaged = await db.electionCopy.create({
          data: {
            ...stored,
            id: crypto.randomUUID(),
            label: "Copia sintética dañada",
            payloadEncrypted: "invalid",
          },
        });
        const before = await db.election.count();
        const result = await req(
          copies + "/" + damaged.id + "/recover",
          "POST",
          recoverInput,
          committee,
        );
        assert.equal(result.status, 409);
        assert.equal(result.data.error.code, "COPY_INVALID");
        assert.equal(await db.election.count(), before);
      },
    );
    await check(
      "Un fallo al copiar el padrón revierte toda la recuperación y permite reintentar",
      async () => {
        const before = await db.election.count();
        await sourceOwner.query(
          "CREATE FUNCTION copies_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic recovery failure'; END $$",
        );
        await sourceOwner.query(
          "CREATE TRIGGER copies_test_fail BEFORE INSERT ON school_drafts FOR EACH ROW EXECUTE FUNCTION copies_test_fail()",
        );
        try {
          assert.ok(
            (await req(recoverPath, "POST", recoverInput, committee)).status >=
              400,
          );
          assert.equal(await db.election.count(), before);
          assert.equal(await db.electionCopyRecovery.count(), 0);
          assert.equal(
            await db.audit.count({
              where: { action: "ELECTION_CREATED_FROM_COPY" },
            }),
            0,
          );
        } finally {
          await sourceOwner.query(
            "DROP TRIGGER copies_test_fail ON school_drafts",
          );
          await sourceOwner.query("DROP FUNCTION copies_test_fail()");
        }
      },
    );
    const oldAudit = await db.audit.findMany({
      where: { electionId: source.id },
    });
    let recovered: any;
    await check(
      "Dos reintentos concurrentes recuperan una sola elección con cero votos",
      async () => {
        const responses = await Promise.all([
          req(recoverPath, "POST", recoverInput, committee),
          req(recoverPath, "POST", recoverInput, committee),
        ]);
        recovered = success(responses[0]);
        assert.equal(success(responses[1]).id, recovered.id);
        assert.notEqual(recovered.id, source.id);
        assert.equal(recovered.state, "BORRADOR");
        assert.equal(
          await db.electionCopyRecovery.count({ where: { copyId: copy.id } }),
          1,
        );
        assert.equal(
          (
            await req(
              recoverPath,
              "POST",
              { ...recoverInput, name: "Otro nombre con mismo identificador" },
              committee,
            )
          ).status,
          409,
        );
        for (const model of [
          db.ballot,
          db.voterSession,
          db.credential,
          db.report,
        ])
          assert.equal(
            await model.count({ where: { electionId: recovered.id } }),
            0,
          );
      },
    );
    await check(
      "Se recuperan los valores guardados, listas, logos, 1742 registros y 25 extranjeros",
      async () => {
        const e = success(
          await req(
            "/admin/elections/" + recovered.id,
            "GET",
            undefined,
            committee,
          ),
        );
        assert.equal(e.name, recoverInput.name);
        assert.equal(e.regulation, "Reglamento original del ensayo");
        assert.equal(e.blankAllowed, true);
        assert.equal(e.nullAllowed, false);
        assert.equal(e.institutionalApprovalReference, "Acta sintética 2027");
        assert.ok(e.windows.every((w: any) => w.state === "PROGRAMADA"));
        assert.equal(
          e.windows.find((w: any) => w.shift === "MANANA").startsAt,
          "2027-11-13T13:00:00.000Z",
        );
        const restoredLists = await db.electoralList.findMany({
          where: { electionId: recovered.id },
          orderBy: { number: "asc" },
        });
        assert.equal(restoredLists.length, 2);
        assert.equal(restoredLists[0].name, lists[0].name);
        assert.equal(restoredLists[0].symbol, lists[0].symbol);
        assert.deepEqual(restoredLists[0].candidates, lists[0].candidates);
        assert.notEqual(restoredLists[0].id, lists[0].id);
        const restoredSchool = success(
          await req(
            `/admin/elections/${recovered.id}/roster/school`,
            "GET",
            undefined,
            committee,
          ),
        );
        assert.equal(restoredSchool.total, 1742);
        assert.equal(restoredSchool.foreign, 25);
        assert.equal(restoredSchool.eligible, 1740);
        assert.equal(
          await db.participation.count({
            where: { electionId: recovered.id, state: "VOTO_EMITIDO" },
          }),
          0,
        );
        for (const studentId of [disabled.studentId, inactive.studentId])
          assert.equal(
            (
              await db.participation.findUniqueOrThrow({
                where: {
                  electionId_studentId: { electionId: recovered.id, studentId },
                },
              })
            ).state,
            "ANULADA_POR_COMITE",
          );
        assert.equal(
          (
            await db.student.findUniqueOrThrow({
              where: { id: inactive.studentId },
            })
          ).active,
          false,
        );
      },
    );
    await check(
      "La elección anterior conserva sus cambios posteriores, voto y auditoría",
      async () => {
        assert.equal(
          (await db.election.findUniqueOrThrow({ where: { id: source.id } }))
            .name,
          "Nombre posterior a la copia",
        );
        assert.equal(
          await db.ballot.count({ where: { electionId: source.id } }),
          1,
        );
        assert.equal(
          (
            await db.participation.findUniqueOrThrow({
              where: { id: voterRow.id },
            })
          ).state,
          "VOTO_EMITIDO",
        );
        assert.equal(
          await db.schoolDraft.count({ where: { electionId: source.id } }),
          1743,
        );
        for (const event of oldAudit)
          assert.deepEqual(
            await db.audit.findUniqueOrThrow({ where: { id: event.id } }),
            event,
          );
        assert.equal(
          await db.audit.count({
            where: { electionId: source.id, action: "ELECTION_COPY_RECOVERED" },
          }),
          1,
        );
        assert.equal(
          await db.audit.count({
            where: {
              electionId: recovered.id,
              action: "ELECTION_CREATED_FROM_COPY",
            },
          }),
          1,
        );
      },
    );
    await check(
      "El mismo estudiante puede votar en la nueva elección sin alterar su voto anterior",
      async () => {
        await sourceOwner.query(
          "UPDATE elections SET state='EN_CURSO' WHERE id=$1",
          [recovered.id],
        );
        await sourceOwner.query(
          'UPDATE windows SET state=\'ABIERTA\', "startsAt"=NULL, "endsAt"=NULL WHERE "electionId"=$1 AND shift=\'MANANA\'',
          [recovered.id],
        );
        const signedAgain = await req("/voter/dni-sessions", "POST", {
          electionId: recovered.id,
          dni: "10000100",
        });
        const session = {
          cookie: signedAgain.cookies.join("; "),
          csrf: success(signedAgain).csrfToken,
        };
        success(
          await req(
            "/voter/votes",
            "POST",
            { electionId: recovered.id, kind: "BLANCO" },
            session,
          ),
        );
        assert.equal(
          await db.ballot.count({ where: { electionId: source.id } }),
          1,
        );
        assert.equal(
          await db.ballot.count({ where: { electionId: recovered.id } }),
          1,
        );
      },
    );
    await check(
      "Readiness exige las tablas de copias y se recupera al estar disponibles",
      async () => {
        await sourceOwner.query(
          "ALTER TABLE election_copies RENAME TO election_copies_unavailable",
        );
        try {
          assert.equal((await req("/health/ready")).status, 503);
        } finally {
          await sourceOwner.query(
            "ALTER TABLE election_copies_unavailable RENAME TO election_copies",
          );
        }
        assert.equal((await req("/health/ready")).status, 200);
      },
    );
  } finally {
    await sourceOwner.end();
  }
  console.log(
    `${passed} comprobaciones de copias aprobadas; solo datos sintéticos.`,
  );
} finally {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  if (db) await db.$disconnect();
  await owner.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await owner.end();
}
