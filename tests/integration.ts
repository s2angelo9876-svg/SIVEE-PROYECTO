import "dotenv/config";
import pg from "pg";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const ownerUrl = new URL(process.env.MIGRATION_DATABASE_URL!);
const appUrl = new URL(process.env.DATABASE_URL!);
const name = "sivee_test_" + crypto.randomBytes(4).toString("hex");
const owner = new pg.Client({ connectionString: ownerUrl.toString() });
await owner.connect();
await owner.query(`CREATE DATABASE "${name}"`);
ownerUrl.pathname = "/" + name;
appUrl.pathname = "/" + name;
process.env.DATABASE_URL = appUrl.toString();
process.env.MIGRATION_DATABASE_URL = ownerUrl.toString();
process.env.SIVEE_ENV = "test";
process.env.ALLOW_DEMO_RESET = "false";
const evidence: { test: string; passed: boolean; detail?: unknown }[] = [];
let server: any;
let db: any;
let connection: pg.Client | undefined;
try {
  for (const script of ["scripts/migrate.ts", "apps/api/prisma/seed-demo.ts"])
    execFileSync(process.execPath, ["--import", "tsx", script], {
      env: process.env,
      stdio: "pipe",
    });
  ({ db } = await import("../apps/api/src/db.js"));
  const { app } = await import("../apps/api/src/app.js");
  const { hashSecret, csrfFor, newToken } = await import(
    "../apps/api/src/security.js"
  );
  connection = new pg.Client({ connectionString: ownerUrl.toString() });
  await connection.connect();
  server = await new Promise<any>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  type Session = { cookie: string; csrf: string };
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    s?: Session,
    headers: Record<string, string> = {},
  ) {
    const r = await fetch(base + path, {
      method,
      headers: {
        Origin: process.env.WEB_ORIGIN!,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(s ? { Cookie: s.cookie, "X-CSRF-Token": s.csrf } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const ct = r.headers.get("content-type") || "";
    const data = ct.includes("json")
      ? await r.json()
      : Buffer.from(await r.arrayBuffer());
    return {
      status: r.status,
      data,
      cookie: r.headers.get("set-cookie")?.split(";")[0] || "",
      headers: r.headers,
    };
  }
  async function login(email: string) {
    const r = await request("/admin/auth/login", "POST", {
      email,
      password: "DemoSivee2026!",
    });
    assert.equal(r.status, 200);
    return { cookie: r.cookie, csrf: r.data.data.csrfToken };
  }
  const committee = await login("comite@sivee.demo");
  const observer = await login("observador@sivee.demo");
  const tech = await login("tecnico@sivee.demo");
  const elections = await request(
    "/admin/elections",
    "GET",
    undefined,
    committee,
  );
  const e = elections.data.data[0];
  const id = e.id;
  const route = "/admin/elections/" + id;
  const lists = await db.electoralList.findMany({
    where: { electionId: id },
    orderBy: { number: "asc" },
  });
  async function check(label: string, fn: () => Promise<unknown>) {
    const detail = await fn();
    evidence.push({ test: label, passed: true, ...(detail ? { detail } : {}) });
    console.log("PASS", label);
  }
  async function post(path: string, body: unknown = {}, s = committee) {
    const r = await request(route + path, "POST", body, s);
    assert.ok(
      r.status >= 200 && r.status < 300,
      `${path}: ${r.status} ${JSON.stringify(r.data)}`,
    );
    return r.data.data;
  }
  await check("API y base de datos responden", async () =>
    assert.equal((await request("/health/ready")).status, 200),
  );
  await check("Sin autenticación no hay panel ni resultados", async () => {
    assert.equal((await request(route + "/turnout")).status, 401);
    assert.equal((await request(route + "/results")).status, 401);
  });
  await check(
    "Embargo por API para todos los roles antes de publicación",
    async () => {
      for (const s of [committee, observer, tech])
        assert.equal(
          (await request(route + "/results", "GET", undefined, s)).status,
          403,
        );
    },
  );
  await check("CSRF y origen externo rechazados", async () => {
    assert.equal(
      (
        await request(
          route + "/prepare",
          "POST",
          {},
          { ...committee, csrf: "" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(route + "/prepare", "POST", {}, committee, {
          Origin: "https://example.invalid",
        })
      ).status,
      403,
    );
  });
  await check("Observador no puede abrir ni exportar", async () => {
    assert.equal(
      (
        await request(
          route + "/windows/MANANA/open",
          "POST",
          { reason: "Prueba de permiso" },
          observer,
        )
      ).status,
      403,
    );
    assert.equal(
      (await request(route + "/reports/final.pdf", "GET", undefined, observer))
        .status,
      403,
    );
  });
  await check("DNI solo y error de código no revelan identidad", async () => {
    const bad = await request("/voter/sessions", "POST", {
      electionId: id,
      dni: "00000001",
      accessCode: "incorrecto",
    });
    const missing = await request("/voter/sessions", "POST", {
      electionId: id,
      dni: "99999999",
      accessCode: "incorrecto",
    });
    assert.equal(bad.status, 401);
    assert.equal(missing.data.error.message, bad.data.error.message);
    assert.ok(!JSON.stringify(bad.data).includes("María"));
    assert.equal(
      (
        await request("/voter/sessions", "POST", {
          electionId: id,
          dni: "00000001",
        })
      ).status,
      401,
    );
  });
  await check("Padrón CSV duplicado rechazado sin cambios", async () => {
    const csv =
      "dni,apellidos_nombres,grado,seccion,turno,habilitado\n00000101,Ana Demo,3,A,MANANA,true\n00000101,Ana Demo,3,A,MANANA,true";
    const r = await request(
      route + "/roster/import-preview",
      "POST",
      { csv },
      committee,
    );
    assert.equal(r.data.data.errors.length, 1);
    assert.equal(
      (
        await request(
          route + "/roster/import-commit",
          "POST",
          { csv },
          committee,
        )
      ).status,
      400,
    );
    assert.equal(
      await db.participation.count({ where: { electionId: id } }),
      50,
    );
  });
  // Exercise real simultaneous requests for fifty identities in one open window.
  await connection.query(
    "UPDATE participations SET shift='MANANA' WHERE \"electionId\"=$1",
    [id],
  );
  await connection.query("UPDATE students SET shift='MANANA'");
  await post("/prepare");
  await post("/windows/MANANA/open", {
    reason: "Apertura para prueba automatizada",
  });
  await check("No se modifica configuración después de preparar", async () =>
    assert.equal(
      (
        await request(
          route + "/lists",
          "POST",
          {
            number: 4,
            name: "No permitida",
            symbol: "star",
            color: "#167568",
            candidates: [{ name: "Persona Demo", position: "Alcaldía" }],
            proposal: "",
            active: true,
          },
          committee,
        )
      ).status,
      409,
    ),
  );
  const sessions: Session[] = [];
  const participations = await db.participation.findMany({
    where: { electionId: id },
  });
  for (const p of participations) {
    const token = newToken();
    await db.voterSession.create({
      data: {
        studentId: p.studentId,
        electionId: id,
        tokenHash: hashSecret(token),
        expiresAt: new Date(Date.now() + 300000),
      },
    });
    sessions.push({ cookie: "sivee_voter=" + token, csrf: csrfFor(token) });
  }
  const vote = (s: Session, body: any) =>
    request("/voter/votes", "POST", { electionId: id, ...body }, s, {
      "Idempotency-Key": crypto.randomUUID(),
    });
  await check("Tipo de voto y lista se validan estrictamente", async () => {
    assert.equal(
      (await vote(sessions[0], { kind: "BLANCO", listId: lists[0].id })).status,
      400,
    );
    assert.equal(
      (await vote(sessions[0], { kind: "VALIDO", listId: crypto.randomUUID() }))
        .status,
      400,
    );
    assert.equal(await db.ballot.count({ where: { electionId: id } }), 0);
  });
  await check(
    "Rollback: fallo de INSERT revierte la participación",
    async () => {
      await connection!.query(
        "CREATE FUNCTION test_fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced-test-failure'; END $$; CREATE TRIGGER test_forced_failure BEFORE INSERT ON ballots FOR EACH ROW EXECUTE FUNCTION test_fail_insert()",
      );
      const r = await vote(sessions[0], { kind: "BLANCO" });
      assert.equal(r.status, 500);
      assert.equal(
        (
          await db.participation.findUnique({
            where: { id: participations[0].id },
          })
        ).state,
        "PENDIENTE",
      );
      assert.equal(await db.ballot.count({ where: { electionId: id } }), 0);
      await connection!.query(
        "DROP TRIGGER test_forced_failure ON ballots; DROP FUNCTION test_fail_insert()",
      );
    },
  );
  await check(
    "100 solicitudes concurrentes del mismo elector = una papeleta",
    async () => {
      const responses = await Promise.all(
        Array.from({ length: 100 }, () =>
          vote(sessions[0], { kind: "VALIDO", listId: lists[0].id }),
        ),
      );
      assert.equal(responses.filter((r) => r.status === 201).length, 1);
      assert.equal(responses.filter((r) => r.status === 200).length, 99);
      assert.equal(await db.ballot.count({ where: { electionId: id } }), 1);
      for (const r of responses)
        assert.ok(!JSON.stringify(r.data).includes("listId"));
    },
  );
  await check(
    "50 identidades concurrentes conservan unicidad y totales",
    async () => {
      const times: number[] = [];
      const start = performance.now();
      const replies = await Promise.all(
        sessions.map(async (s, i) => {
          const t = performance.now();
          const r = await vote(
            s,
            i < 38
              ? { kind: "VALIDO", listId: lists[i % 3].id }
              : i < 45
                ? { kind: "BLANCO" }
                : { kind: "NULO" },
          );
          times.push(performance.now() - t);
          return r;
        }),
      );
      assert.equal(replies.filter((r) => r.status === 201).length, 49);
      assert.equal(replies.filter((r) => r.status === 200).length, 1);
      assert.equal(await db.ballot.count({ where: { electionId: id } }), 50);
      assert.equal(
        await db.participation.count({
          where: { electionId: id, state: "VOTO_EMITIDO" },
        }),
        50,
      );
      times.sort((a, b) => a - b);
      return {
        requests: 50,
        wallMs: Math.round(performance.now() - start),
        p95Ms: Math.round(times[47]),
      };
    },
  );
  await check(
    "Papeletas sin identidad ni cronología y sin UPDATE/DELETE",
    async () => {
      const cols = await connection!.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name='ballots'",
      );
      assert.deepEqual(cols.rows.map((x) => x.column_name).sort(), [
        "electionId",
        "id",
        "kind",
        "listId",
      ]);
      await assert.rejects(
        db.$executeRawUnsafe("UPDATE ballots SET kind='NULO'"),
      );
      await assert.rejects(db.$executeRawUnsafe("DELETE FROM ballots"));
    },
  );
  await check("SSE autenticado solo emite participación", async () => {
    const controller = new AbortController();
    const r = await fetch(base + route + "/events", {
      headers: { Cookie: committee.cookie },
      signal: controller.signal,
    });
    assert.equal(r.status, 200);
    const chunk = await r.body!.getReader().read();
    const text = new TextDecoder().decode(chunk.value);
    controller.abort();
    assert.match(text, /turnout.updated/);
    assert.ok(!/listId|lists|valid|blank|null/.test(text));
  });
  await check(
    "Voto simultáneo con cierre: sin confirmaciones parciales (8 carreras)",
    async () => {
      let accepted = 0;
      for (let round = 0; round < 8; round++) {
        const race = await db.election.create({
          data: {
            institutionId: e.institutionId,
            name: "Carrera de voto y cierre",
            windows: { create: [{ shift: "MANANA" }] },
          },
        });
        for (let n = 1; n <= 2; n++)
          await db.electoralList.create({
            data: {
              electionId: race.id,
              number: n,
              name: "Lista de prueba " + n,
              candidates: [
                { name: "Candidato ficticio", position: "Alcaldía" },
              ],
            },
          });
        const studentId = participations[0].studentId;
        await db.participation.create({
          data: { electionId: race.id, studentId, shift: "MANANA" },
        });
        const original = await db.credential.findFirstOrThrow({
          where: { studentId, electionId: id },
        });
        await db.credential.create({
          data: {
            electionId: race.id,
            studentId,
            codeHash: original.codeHash,
            expiresAt: new Date(Date.now() + 86400000),
          },
        });
        const root = "/admin/elections/" + race.id;
        assert.equal(
          (await request(root + "/prepare", "POST", {}, committee)).status,
          200,
        );
        assert.equal(
          (
            await request(
              root + "/windows/MANANA/open",
              "POST",
              { reason: "Prueba de carrera" },
              committee,
            )
          ).status,
          200,
        );
        const token = newToken();
        await db.voterSession.create({
          data: {
            studentId,
            electionId: race.id,
            tokenHash: hashSecret(token),
            expiresAt: new Date(Date.now() + 300000),
          },
        });
        const sess = { cookie: "sivee_voter=" + token, csrf: csrfFor(token) };
        const [v, c] = await Promise.all([
          request(
            "/voter/votes",
            "POST",
            { electionId: race.id, kind: "BLANCO" },
            sess,
            { "Idempotency-Key": crypto.randomUUID() },
          ),
          request(
            root + "/windows/MANANA/close",
            "POST",
            { reason: "Cierre concurrente de prueba" },
            committee,
          ),
        ]);
        assert.equal(c.status, 200);
        assert.ok([201, 409].includes(v.status));
        const ballots = await db.ballot.count({
          where: { electionId: race.id },
        });
        const participationsCount = await db.participation.count({
          where: { electionId: race.id, state: "VOTO_EMITIDO" },
        });
        assert.equal(ballots, participationsCount);
        assert.equal(ballots, v.status === 201 ? 1 : 0);
        accepted += ballots;
      }
      return {
        races: 8,
        acceptedBeforeClose: accepted,
        rejectedAfterClose: 8 - accepted,
      };
    },
  );
  await post("/windows/MANANA/close", { reason: "Fin del primer turno" });
  await post("/windows/TARDE/open", { reason: "Inicio del segundo turno" });
  await post("/windows/TARDE/close", { reason: "Fin del segundo turno" });
  // The temporary exception covers closure and publication with password-only accounts.
  const second = await request(
    "/admin/accounts",
    "POST",
    {
      name: "Segunda Autoridad Sintética",
      email: "segunda@sivee.demo",
      password: "DemoSivee2026!",
      role: "COMITE",
      electionScope: id,
    },
    tech,
  );
  assert.equal(second.status, 200);
  await login("segunda@sivee.demo");
  await connection!.query("UPDATE elections SET mode='OFICIAL' WHERE id=$1", [
    id,
  ]);
  const close = await post("/close-request", {
    reason: "Finalización de la prueba",
  });
  await check(
    "Cierre oficial temporal permite aprobar la propia solicitud y conserva permisos y auditoría",
    async () => {
      for (const unauthorized of [observer, tech]) {
        assert.equal(
          (
            await request(
              route + "/close-request",
              "POST",
              { reason: "Intento sin permiso de cierre" },
              unauthorized,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              route + "/close-approve",
              "POST",
              { approvalId: close.id },
              unauthorized,
            )
          ).status,
          403,
        );
      }
      assert.equal(
        (
          await request(
            route + "/close-approve",
            "POST",
            { approvalId: crypto.randomUUID() },
            committee,
          )
        ).status,
        409,
      );
      assert.equal(
        (await db.election.findUniqueOrThrow({ where: { id } })).state,
        "PAUSADA",
      );
      await post("/close-approve", { approvalId: close.id });
      const approved = await db.approval.findUniqueOrThrow({
        where: { id: close.id },
      });
      assert.equal(approved.state, "APPROVED");
      assert.equal(approved.requesterId, approved.approverId);
      const events = await db.audit.findMany({
        where: {
          electionId: id,
          action: { in: ["CLOSE_REQUESTED", "CLOSE_APPROVED"] },
        },
      });
      assert.equal(events.length, 2);
      assert.ok(
        events.every(
          (event: any) =>
            event.adminId === approved.requesterId &&
            event.detail.distinctAccountRequired === false,
        ),
      );
      const audit = events.find(
        (event: any) => event.action === "CLOSE_APPROVED",
      );
      assert.equal(audit.detail.approvalId, close.id);
      assert.equal(audit.detail.sameAccountApproval, true);
      assert.equal(
        (
          await request(
            route + "/close-approve",
            "POST",
            { approvalId: close.id },
            committee,
          )
        ).status,
        409,
      );
      assert.equal(
        await db.audit.count({
          where: { electionId: id, action: "CLOSE_APPROVED" },
        }),
        1,
      );
    },
  );
  await check("Cerrada aún no expone preferencias", async () =>
    assert.equal(
      (await request(route + "/results", "GET", undefined, committee)).status,
      403,
    ),
  );
  await check("Conciliación inconsistente bloquea publicación", async () => {
    await connection!.query(
      "UPDATE participations SET state='PENDIENTE' WHERE id=$1",
      [participations[0].id],
    );
    const r = await request(route + "/reconcile", "POST", {}, committee);
    assert.equal(r.status, 409);
    assert.equal(r.data.error.code, "RECONCILIATION_FAILED");
    await connection!.query(
      "UPDATE participations SET state='VOTO_EMITIDO' WHERE id=$1",
      [participations[0].id],
    );
  });
  await check("Publicación sigue bloqueada antes de conciliar", async () => {
    assert.equal(
      (
        await request(
          route + "/publish-request",
          "POST",
          { reason: "Intento anterior a la conciliación" },
          committee,
        )
      ).status,
      409,
    );
  });
  await post("/reconcile");
  await check("Conciliada sigue reservada", async () =>
    assert.equal(
      (await request(route + "/results", "GET", undefined, committee)).status,
      403,
    ),
  );
  const publish = await post("/publish-request", {
    reason: "Publicación de resultados conciliados",
  });
  await check(
    "Publicación oficial temporal permite la misma cuenta y conserva permisos, integridad y auditoría",
    async () => {
      for (const unauthorized of [observer, tech]) {
        assert.equal(
          (
            await request(
              route + "/publish-request",
              "POST",
              { reason: "Intento sin permiso de publicación" },
              unauthorized,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              route + "/publish-approve",
              "POST",
              { approvalId: publish.id },
              unauthorized,
            )
          ).status,
          403,
        );
      }
      assert.equal(
        (
          await request(
            route + "/publish-approve",
            "POST",
            { approvalId: crypto.randomUUID() },
            committee,
          )
        ).status,
        409,
      );
      assert.equal(
        (await db.election.findUniqueOrThrow({ where: { id } })).state,
        "CONCILIADA",
      );
      // Even the single-account exception cannot publish a tampered report.
      const report = await db.report.findFirstOrThrow({
        where: { electionId: id },
        orderBy: { version: "desc" },
      });
      await connection!.query("UPDATE reports SET sha256=$1 WHERE id=$2", [
        "synthetic-invalid-digest",
        report.id,
      ]);
      assert.equal(
        (
          await request(
            route + "/publish-approve",
            "POST",
            { approvalId: publish.id },
            committee,
          )
        ).status,
        409,
      );
      assert.equal(
        (await db.approval.findUniqueOrThrow({ where: { id: publish.id } }))
          .state,
        "PENDING",
      );
      await connection!.query("UPDATE reports SET sha256=$1 WHERE id=$2", [
        report.sha256,
        report.id,
      ]);
      await post("/publish-approve", { approvalId: publish.id });
      const records = await db.approval.findMany({
        where: { electionId: id, state: "APPROVED" },
      });
      assert.equal(records.length, 2);
      assert.ok(records.every((a: any) => a.requesterId === a.approverId));
      const events = await db.audit.findMany({
        where: {
          electionId: id,
          action: { in: ["PUBLISH_REQUESTED", "PUBLISH_APPROVED"] },
        },
      });
      assert.equal(events.length, 2);
      const publication = records.find((a: any) => a.type === "publish");
      assert.ok(
        events.every(
          (event: any) =>
            event.adminId === publication.requesterId &&
            event.detail.distinctAccountRequired === false,
        ),
      );
      const audit = events.find(
        (event: any) => event.action === "PUBLISH_APPROVED",
      );
      assert.equal(audit.detail.approvalId, publish.id);
      assert.equal(audit.detail.sameAccountApproval, true);
      assert.equal(
        (
          await request(
            route + "/publish-approve",
            "POST",
            { approvalId: publish.id },
            committee,
          )
        ).status,
        409,
      );
      assert.equal(
        await db.audit.count({
          where: { electionId: id, action: "PUBLISH_APPROVED" },
        }),
        1,
      );
    },
  );
  await check(
    "Publicación: 50 = 38 válidos + 7 blancos + 5 nulos",
    async () => {
      const r = await request(route + "/results", "GET", undefined, committee);
      assert.equal(r.status, 200);
      assert.equal(r.data.data.summary.valid, 38);
      assert.equal(r.data.data.summary.blank, 7);
      assert.equal(r.data.data.summary.null, 5);
      assert.equal(r.data.data.summary.reconciled, true);
      assert.equal(
        r.data.data.summary.lists.reduce((a: number, l: any) => a + l.votes, 0),
        38,
      );
    },
  );
  await check(
    "Acta PDF y CSV válidos; exportación de observador denegada",
    async () => {
      const pdf = await request(
        route + "/reports/final.pdf",
        "GET",
        undefined,
        committee,
      );
      assert.equal(pdf.status, 200);
      assert.equal(pdf.data.subarray(0, 4).toString(), "%PDF");
      const csv = await request(
        route + "/reports/final.csv",
        "GET",
        undefined,
        committee,
      );
      assert.equal(csv.status, 200);
      assert.match(csv.data.toString(), /Blancos/);
      assert.equal(
        (
          await request(
            route + "/reports/final.pdf",
            "GET",
            undefined,
            observer,
          )
        ).status,
        403,
      );
    },
  );
  await check("Cierre irreversible y reinicio prohibido en TEST", async () => {
    assert.equal(
      (
        await request(
          route + "/windows/MANANA/open",
          "POST",
          { reason: "Reapertura inválida" },
          committee,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await request(
          "/admin/demo/" + id + "/reset",
          "POST",
          { confirmation: "NUEVA SIMULACION" },
          committee,
        )
      ).status,
      409,
    );
  });
  await check("Aislamiento de instituciones ante cambio de UUID", async () => {
    const other = await db.institution.create({
      data: { code: crypto.randomUUID(), name: "Otra institución" },
    });
    const foreign = await db.election.create({
      data: { institutionId: other.id, name: "Elección ajena" },
    });
    assert.equal(
      (
        await request(
          "/admin/elections/" + foreign.id + "/turnout",
          "GET",
          undefined,
          committee,
        )
      ).status,
      404,
    );
  });
  await check("Sesión vencida y revocada no permite votar", async () => {
    await db.voterSession.updateMany({
      where: { studentId: participations[1].studentId },
      data: { expiresAt: new Date(0) },
    });
    assert.equal((await vote(sessions[1], { kind: "BLANCO" })).status, 401);
  });
  await check(
    "Las rutas retiradas del autenticador no están disponibles",
    async () => {
      for (const path of ["/admin/mfa/setup", "/admin/mfa/confirm"])
        assert.equal((await request(path, "POST", {}, committee)).status, 404);
    },
  );
  await check(
    "Seed repetible conserva institución editada y votos",
    async () => {
      const beforeInstitutions = await db.institution.count();
      const beforeVotes = await db.ballot.count();
      await db.institution.update({
        where: { id: e.institutionId },
        data: { code: "DEMO-EDITADA" },
      });
      execFileSync(
        process.execPath,
        ["--import", "tsx", "apps/api/prisma/seed-demo.ts"],
        {
          env: process.env,
          stdio: "pipe",
        },
      );
      assert.equal(await db.institution.count(), beforeInstitutions);
      assert.equal(await db.ballot.count(), beforeVotes);
      assert.equal(
        (await db.institution.findUnique({ where: { id: e.institutionId } }))
          .code,
        "DEMO-EDITADA",
      );
    },
  );
  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync(
    "artifacts/integration-results.json",
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        database: "PostgreSQL 17 aislada",
        passed: evidence.length,
        tests: evidence,
      },
      null,
      2,
    ),
  );
  console.log(`Integración: ${evidence.length} comprobaciones aprobadas.`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  if (server) await new Promise<void>((r) => server.close(() => r()));
  if (db) await db.$disconnect();
  if (connection) await connection.end();
  await owner.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await owner.end();
}
