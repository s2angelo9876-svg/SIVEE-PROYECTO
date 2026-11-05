import { Prisma } from "@prisma/client";
import crypto from "node:crypto";
import { parse } from "csv-parse/sync";
import { db } from "./db.js";
import {
  AppError,
  requireState,
  dniLookup,
  passwordHash,
  digest,
} from "./security.js";
import {
  voteSchema,
  rosterRowSchema,
  assertReconciled,
  electoralOutcome,
} from "../../../packages/shared/domain.js";
export type Tx = Prisma.TransactionClient;
export const audit = (
  tx: Tx,
  adminId: string | null,
  electionId: string | null,
  action: string,
  detail: Prisma.InputJsonValue = {},
) => tx.audit.create({ data: { adminId, electionId, action, detail } });
export async function lockElection(tx: Tx, id: string, exclusive = false) {
  if (exclusive)
    await tx.$queryRaw`SELECT id FROM elections WHERE id=${id}::uuid FOR UPDATE`;
  else
    await tx.$queryRaw`SELECT id FROM elections WHERE id=${id}::uuid FOR SHARE`;
  const e = await tx.election.findUnique({
    where: { id },
    include: { windows: true, institution: true },
  });
  if (!e) throw new AppError(404, "NOT_FOUND", "Elección no encontrada.");
  return e;
}
export function windowAvailable(
  e: { state: string },
  w:
    | { state: string; startsAt: Date | null; endsAt: Date | null }
    | null
    | undefined,
) {
  const now = Date.now();
  return (
    e.state === "EN_CURSO" &&
    w?.state === "ABIERTA" &&
    (!w.startsAt || +w.startsAt <= now) &&
    (!w.endsAt || +w.endsAt > now)
  );
}
export async function turnout(tx: Tx, id: string) {
  const eligible = await tx.participation.count({
    where: { electionId: id, state: { in: ["PENDIENTE", "VOTO_EMITIDO"] } },
  });
  const voted = await tx.participation.count({
    where: { electionId: id, state: "VOTO_EMITIDO" },
  });
  return {
    eligible,
    voted,
    remaining: eligible - voted,
    participationPct: eligible
      ? Math.round((voted * 10000) / eligible) / 100
      : 0,
  };
}
export async function tally(tx: Tx, id: string) {
  const base = await turnout(tx, id);
  const groups = await tx.ballot.groupBy({
    by: ["kind"],
    where: { electionId: id },
    _count: true,
  });
  const n = (kind: string) => groups.find((x) => x.kind === kind)?._count || 0;
  const listRows = await tx.electoralList.findMany({
    where: { electionId: id },
    orderBy: { number: "asc" },
    include: { _count: { select: { ballots: true } } },
  });
  const lists = listRows.map((l) => ({
    id: l.id,
    number: l.number,
    name: l.name,
    color: l.color,
    symbol: l.symbol,
    votes: l._count.ballots,
  }));
  const s = {
    ...base,
    ballots: groups.reduce((a, g) => a + g._count, 0),
    valid: n("VALIDO"),
    blank: n("BLANCO"),
    null: n("NULO"),
    lists,
  };
  return {
    ...s,
    reconciled: assertReconciled(s),
    outcome: electoralOutcome(lists),
  };
}
export async function castVote(sessionId: string, raw: unknown) {
  const input = voteSchema.parse(raw);
  return db.$transaction(
    async (tx) => {
      const initial = await tx.voterSession.findUnique({
        where: { id: sessionId },
      });
      if (
        !initial ||
        initial.revoked ||
        +initial.expiresAt < Date.now() ||
        initial.electionId !== input.electionId
      )
        throw new AppError(401, "UNAUTHENTICATED", "La sesión ha vencido.");
      const e = await lockElection(tx, initial.electionId);
      const p = await tx.participation.findUnique({
        where: {
          electionId_studentId: {
            electionId: e.id,
            studentId: initial.studentId,
          },
        },
        include: { student: true },
      });
      if (!p || !p.student.active || p.state === "ANULADA_POR_COMITE")
        throw new AppError(
          403,
          "FORBIDDEN",
          "No tienes habilitada esta elección.",
        );
      if (p.state === "VOTO_EMITIDO") return { status: "ALREADY_RECORDED" };
      if (initial.consumed)
        throw new AppError(401, "UNAUTHENTICATED", "La sesión ha finalizado.");
      await tx.$queryRaw`SELECT id FROM windows WHERE "electionId"=${e.id}::uuid AND shift=${p.shift} FOR SHARE`;
      const w = await tx.window.findUnique({
        where: { electionId_shift: { electionId: e.id, shift: p.shift } },
      });
      if (!windowAvailable(e, w))
        throw new AppError(
          409,
          "VOTING_WINDOW_CLOSED",
          "La votación no está habilitada para tu turno.",
        );
      if (input.kind === "VALIDO") {
        const l = await tx.electoralList.findFirst({
          where: { id: input.listId, electionId: e.id, active: true },
        });
        if (!l)
          throw new AppError(
            400,
            "INVALID_CHOICE",
            "La opción no pertenece a esta cédula.",
          );
      } else if (input.kind === "BLANCO" ? !e.blankAllowed : !e.nullAllowed)
        throw new AppError(
          400,
          "INVALID_CHOICE",
          "Esta opción no está autorizada.",
        );
      const updated = await tx.participation.updateMany({
        where: { id: p.id, state: "PENDIENTE" },
        data: { state: "VOTO_EMITIDO" },
      });
      if (updated.count === 0) return { status: "ALREADY_RECORDED" };
      await tx.ballot.create({
        data: {
          electionId: e.id,
          kind: input.kind,
          listId: input.kind === "VALIDO" ? input.listId : null,
        },
      });
      await tx.voterSession.updateMany({
        where: { studentId: p.studentId, electionId: e.id },
        data: { consumed: true },
      });
      return { status: "RECORDED" };
    },
    { timeout: 20000 },
  );
}
export function parseRoster(csv: string) {
  let raw: unknown[];
  try {
    raw = parse(csv, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
      max_record_size: 2048,
    });
  } catch {
    throw new AppError(
      400,
      "INVALID_CSV",
      "El archivo CSV no tiene un formato válido.",
    );
  }
  if (!raw.length || raw.length > 5000)
    throw new AppError(400, "INVALID_CSV", "Importa entre 1 y 5000 filas.");
  const rows: zRow[] = [];
  const errors: { row: number; message: string }[] = [];
  const seen = new Set<string>();
  raw.forEach((value, i) => {
    const r = rosterRowSchema.safeParse(value);
    if (!r.success) {
      errors.push({
        row: i + 2,
        message:
          "Revisa documento (8 dígitos), nombre, grado 1–6, sección, turno y habilitado true/false.",
      });
      return;
    }
    if (seen.has(r.data.dni)) {
      errors.push({
        row: i + 2,
        message: "Documento duplicado en el archivo.",
      });
      return;
    }
    seen.add(r.data.dni);
    rows.push(r.data);
  });
  return { rows, errors };
}
type zRow = {
  dni: string;
  apellidos_nombres: string;
  grado: string;
  seccion: string;
  turno: "MANANA" | "TARDE";
  habilitado: "true" | "false";
};
export async function checkRoster(
  tx: Tx,
  e: { id: string; institutionId: string; windows: { shift: string }[] },
  rows: zRow[],
) {
  const errors: { row: number; message: string }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!e.windows.some((w) => w.shift === r.turno))
      errors.push({ row: i + 2, message: "Turno no incluido en la elección." });
    const student = await tx.student.findUnique({
      where: {
        institutionId_dniLookup: {
          institutionId: e.institutionId,
          dniLookup: dniLookup(r.dni),
        },
      },
    });
    if (student) {
      if (
        await tx.participation.findUnique({
          where: {
            electionId_studentId: { electionId: e.id, studentId: student.id },
          },
        })
      )
        errors.push({
          row: i + 2,
          message: "Este elector ya está inscrito en la elección.",
        });
      else if (
        student.displayName !== r.apellidos_nombres ||
        student.grade !== r.grado ||
        student.section !== r.seccion ||
        student.shift !== r.turno
      )
        errors.push({
          row: i + 2,
          message:
            "Los datos no coinciden con el padrón institucional existente.",
        });
    }
  }
  return errors;
}
export async function importRoster(
  electionId: string,
  adminId: string,
  csv: string,
) {
  const { rows, errors } = parseRoster(csv);
  if (errors.length)
    throw new AppError(
      400,
      "INVALID_CSV",
      "Corrige todas las filas antes de importar.",
    );
  const credentials = await Promise.all(
    rows.map(async () => {
      const code = crypto.randomBytes(9).toString("base64url");
      return { code, hash: await passwordHash(code) };
    }),
  );
  return db.$transaction(
    async (tx) => {
      const e = await lockElection(tx, electionId, true);
      requireState(e.state === "BORRADOR");
      const invalid = await checkRoster(tx, e, rows);
      if (invalid.length)
        throw new AppError(409, "INVALID_CSV", invalid[0].message);
      const issued = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const student = await tx.student.upsert({
          where: {
            institutionId_dniLookup: {
              institutionId: e.institutionId,
              dniLookup: dniLookup(r.dni),
            },
          },
          create: {
            institutionId: e.institutionId,
            dniLookup: dniLookup(r.dni),
            displayName: r.apellidos_nombres,
            grade: r.grado,
            section: r.seccion,
            shift: r.turno,
          },
          update: {},
        });
        await tx.participation.create({
          data: {
            electionId: e.id,
            studentId: student.id,
            shift: r.turno,
            state: r.habilitado === "true" ? "PENDIENTE" : "ANULADA_POR_COMITE",
          },
        });
        await tx.credential.create({
          data: {
            electionId: e.id,
            studentId: student.id,
            codeHash: credentials[i].hash,
            active: r.habilitado === "true",
            expiresAt: new Date(Date.now() + 30 * 86400000),
          },
        });
        issued.push({
          row: i + 2,
          displayName: r.apellidos_nombres,
          accessCode: credentials[i].code,
          shift: r.turno,
        });
      }
      await audit(tx, adminId, e.id, "ROSTER_IMPORTED", { count: rows.length });
      return { count: rows.length, credentials: issued };
    },
    { timeout: 60000 },
  );
}
export async function reconcile(tx: Tx, id: string, adminId: string) {
  const e = await lockElection(tx, id, true);
  requireState(e.state === "CERRADA");
  requireState(e.windows.every((w) => w.state === "CERRADA"));
  const summary = await tally(tx, id);
  if (!summary.reconciled)
    throw new AppError(
      409,
      "RECONCILIATION_FAILED",
      "La conciliación no coincide. Registra una incidencia; no se publicarán resultados.",
    );
  const version = (await tx.report.count({ where: { electionId: id } })) + 1;
  const snapshot = {
    ...summary,
    electionId: id,
    electionName: e.name,
    institution: e.institution.name,
    scope: e.scope,
    year: e.year,
    version,
    closedAt: e.closedAt?.toISOString(),
    generatedAt: new Date().toISOString(),
    mode: e.mode,
  };
  const report = await tx.report.create({
    data: {
      electionId: id,
      version,
      summary: snapshot,
      sha256: digest(snapshot),
    },
  });
  await tx.election.update({
    where: { id },
    data: { state: "CONCILIADA", version: { increment: 1 } },
  });
  await audit(tx, adminId, id, "RECONCILED", {
    reportId: report.id,
    sha256: report.sha256,
  });
  return { reconciled: true, reportId: report.id, sha256: report.sha256 };
}
