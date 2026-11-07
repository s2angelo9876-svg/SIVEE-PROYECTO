import "dotenv/config";
import pg from "pg";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { schoolFixture } from "./school-fixture.js";
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
  const templateAdmin = await db.admin.findUniqueOrThrow({
    where: { email: "comite@sivee.demo" },
  });
  await db.admin.create({
    data: {
      institutionId: templateAdmin.institutionId,
      name: "Mesa de pruebas",
      email: "mesa@sivee.demo",
      passwordHash: templateAdmin.passwordHash,
      grants: {
        create: {
          role: "MESA",
          permissions: ["desk:verify", "elections:read"],
          electionScope: "*",
        },
      },
    },
  });
  const committee = await login("comite@sivee.demo"),
    observer = await login("observador@sivee.demo"),
    mesa = await login("mesa@sivee.demo");
  const me = success(await req("/admin/me", "GET", undefined, committee));
  const mesaMe = success(await req("/admin/me", "GET", undefined, mesa));
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
      assert.equal(preview.pending, 1742);
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
      assert.equal(state.pending, 1742);
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
    "Asignación explícita de turno, correcciones versionadas y 1742 electores sin códigos",
    async () => {
      success(
        await call(school + "/assign-shift", {
          groups: [{ grade: "1", section: "HONESTIDAD Y RESPETO" }],
          shift: "MANANA",
          reason: "Asignación sintética aprobada para ensayo",
        }),
      );
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
  let booth: any, booth2: any, b: Session, b2: Session;
  async function pair(boothId: string) {
    const p = success(
      await call(`/desk/booths/${boothId}/pairing`, {
        reason: "Activación del navegador del colegio",
      }),
    );
    const params = new URLSearchParams(new URL(p.url).hash.slice(1));
    const body = { id: params.get("id"), token: params.get("token") };
    const response = await req("/booth/pair", "POST", body);
    success(response);
    const session = {
      cookie: response.cookies.find((c) => c.startsWith("sivee_booth="))!,
      csrf: "",
    };
    session.csrf = success(
      await req("/booth/status", "GET", undefined, session),
    ).csrfToken;
    assert.equal((await req("/booth/pair", "POST", body)).status, 401);
    return session;
  }
  await check(
    "Cabina requiere activación de un solo uso; preparar exige cabina activa",
    async () => {
      for (let number = 1; number <= 2; number++)
        success(
          await call("/lists", {
            number,
            name: "Lista " + number,
            symbol: "sprout",
            color: "#0b1f3a",
            candidates: [{ name: "Persona Candidata", position: "Alcaldía" }],
            proposal: "",
            active: true,
          }),
        );
      assert.equal((await call("/prepare", {})).status, 409);
      booth = success(
        await call("/desk/booths", {
          name: "Cabina 1",
          assignedAdminId: me.id,
        }),
      );
      booth2 = success(
        await call("/desk/booths", {
          name: "Cabina 2",
          assignedAdminId: mesaMe.id,
        }),
      );
      b = await pair(booth.id);
      b2 = await pair(booth2.id);
      success(await call("/prepare", {}));
      assert.equal((await call(school + "/import", fixture)).status, 409);
      success(
        await call("/windows/MANANA/open", {
          reason: "Inicio del ensayo automatizado",
        }),
      );
      assert.equal(
        (await req("/booth/requests", "POST", { dni: "10000030" })).status,
        401,
      );
      assert.equal(
        (
          await req("/voter/sessions", "POST", {
            electionId: e.id,
            dni: "10000030",
            accessCode: "CUALQUIER-CODIGO",
          })
        ).status,
        403,
      );
    },
  );
  let admission: any, voter: Session;
  const approve = (requestId: string, document: string, s = committee) =>
    call(
      `/desk/requests/${requestId}/approve`,
      {
        identityVerified: true,
        document,
        reason: "Identidad cotejada presencialmente con documento",
      },
      "POST",
      s,
    );
  const claim = async (session: Session, requestId: string) => {
    const r = await req("/booth/claim", "POST", { requestId }, session);
    const data = success(r);
    return {
      cookie:
        session.cookie +
        "; " +
        r.cookies.find((c) => c.startsWith("sivee_voter=")),
      csrf: data.csrfToken,
    };
  };
  await check(
    "DNI no autoriza: mesa asignada, verificación de documento y sesión ligada a cabina",
    async () => {
      admission = success(
        await req("/booth/requests", "POST", { dni: "10000030" }, b),
      );
      assert.deepEqual(Object.keys(admission).sort(), ["id", "state"]);
      assert.equal(
        (await req("/booth/claim", "POST", { requestId: admission.id }, b))
          .status,
        409,
      );
      assert.equal((await approve(admission.id, "10000030", mesa)).status, 403);
      assert.equal((await approve(admission.id, "10000031")).status, 409);
      success(await approve(admission.id, "10000030"));
      assert.equal(
        (await req("/booth/claim", "POST", { requestId: admission.id }, b2))
          .status,
        409,
      );
      voter = await claim(b, admission.id);
      assert.equal(
        (
          await req("/voter/me", "GET", undefined, {
            ...voter,
            cookie: voter.cookie
              .split("; ")
              .find((c) => c.startsWith("sivee_voter="))!,
          })
        ).status,
        401,
      );
      const identity = success(await req("/voter/me", "GET", undefined, voter));
      assert.equal(identity.student.displayName, "Estudiante Sintético 30");
    },
  );
  await check(
    "Pausa bloquea voto; doble envío concurrente produce una sola papeleta y participación",
    async () => {
      success(
        await call("/windows/MANANA/pause", {
          reason: "Pausa durante el ensayo",
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
      success(
        await call("/windows/MANANA/open", {
          reason: "Reanudación del ensayo",
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
      assert.equal(
        (await db.admission.findUniqueOrThrow({ where: { id: admission.id } }))
          .state,
        "CONSUMED",
      );
      assert.equal(
        (await req("/booth/requests", "POST", { dni: "10000030" }, b)).status,
        403,
      );
    },
  );
  await check(
    "Dos cabinas no habilitan al mismo alumno; cancelación revoca sesión inmediatamente",
    async () => {
      const responses = await Promise.all([
        req("/booth/requests", "POST", { dni: "10000031" }, b),
        req("/booth/requests", "POST", { dni: "10000031" }, b2),
      ]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
      const index = responses.findIndex((r) => r.status === 201),
        session = [b, b2][index],
        r = success(responses[index]);
      success(await approve(r.id, "10000031"));
      const v = await claim(session, r.id);
      success(
        await call(`/desk/requests/${r.id}/cancel`, {
          identityVerified: false,
          reason: "Cancelación por discrepancia de identidad",
        }),
      );
      assert.equal(
        (
          await req(
            "/voter/votes",
            "POST",
            { electionId: e.id, kind: "BLANCO" },
            v,
          )
        ).status,
        401,
      );
    },
  );
  await check(
    "Revincular navegador invalida autorizaciones y expirar obliga nueva verificación",
    async () => {
      const r = success(
        await req("/booth/requests", "POST", { dni: "10000032" }, b),
      );
      success(await approve(r.id, "10000032"));
      const v = await claim(b, r.id),
        oldBooth = b;
      b = await pair(booth.id);
      assert.equal(
        (await req("/booth/status", "GET", undefined, oldBooth)).status,
        401,
      );
      assert.equal(
        (
          await req(
            "/voter/votes",
            "POST",
            { electionId: e.id, kind: "BLANCO" },
            v,
          )
        ).status,
        401,
      );
      const expired = success(
        await req("/booth/requests", "POST", { dni: "10000033" }, b),
      );
      success(await approve(expired.id, "10000033"));
      const ev = await claim(b, expired.id);
      await db.admission.update({
        where: { id: expired.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      assert.equal((await req("/voter/me", "GET", undefined, ev)).status, 401);
      assert.equal(
        success(await req("/booth/requests", "POST", { dni: "10000033" }, b))
          .state,
        "WAITING",
      );
    },
  );
  await check(
    "Cancelación en cola invalida un voto que ya había pasado autenticación",
    async () => {
      const r = success(
        await req("/booth/requests", "POST", { dni: "10000035" }, b2),
      );
      success(await approve(r.id, "10000035"));
      const v = await claim(b2, r.id);
      const gate = new pg.Client({ connectionString: ownerUrl.toString() });
      await gate.connect();
      await gate.query("BEGIN");
      let cancelling: ReturnType<typeof call> | undefined,
        voting: ReturnType<typeof req> | undefined;
      async function queued(fragment: string) {
        for (let i = 0; i < 100; i++) {
          const count = await owner.query(
            "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock' AND query LIKE $2",
            [name, "%" + fragment + "%"],
          );
          if (count.rows[0].n > 0) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error("No llegó a la barrera: " + fragment);
      }
      try {
        await gate.query("SELECT id FROM elections WHERE id=$1 FOR UPDATE", [
          e.id,
        ]);
        cancelling = call(`/desk/requests/${r.id}/cancel`, {
          identityVerified: false,
          reason: "Cancelación concurrente por la mesa",
        });
        await queued("FOR UPDATE");
        voting = req(
          "/voter/votes",
          "POST",
          { electionId: e.id, kind: "BLANCO" },
          v,
        );
        await queued("FOR SHARE");
      } finally {
        await gate.query("COMMIT");
        await gate.end();
      }
      success(await cancelling!);
      assert.equal((await voting!).status, 401);
      assert.equal(await db.ballot.count({ where: { electionId: e.id } }), 1);
    },
  );
  await check(
    "Salir de la cédula cancela autorización sin impedir al siguiente alumno",
    async () => {
      const r = success(
        await req("/booth/requests", "POST", { dni: "10000036" }, b2),
      );
      success(await approve(r.id, "10000036"));
      const v = await claim(b2, r.id);
      success(await req("/voter/logout", "POST", {}, v));
      assert.equal(
        (await db.admission.findUniqueOrThrow({ where: { id: r.id } })).state,
        "CANCELLED",
      );
      assert.equal(
        success(await req("/booth/requests", "POST", { dni: "10000037" }, b2))
          .state,
        "WAITING",
      );
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
