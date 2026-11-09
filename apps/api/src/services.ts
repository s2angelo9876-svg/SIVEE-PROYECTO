import { Prisma } from "@prisma/client";
import { db } from "./db.js";
import { AppError, requireState, digest } from "./security.js";
import {
  voteSchema,
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
        initial.admissionId ||
        +initial.expiresAt < Date.now() ||
        initial.electionId !== input.electionId
      )
        throw new AppError(401, "UNAUTHENTICATED", "La sesión ha vencido.");
      const e = await lockElection(tx, initial.electionId);
      // Credential rotation may have revoked this session while we waited for the lock.
      const currentSession = await tx.voterSession.findUnique({
        where: { id: sessionId },
      });
      if (
        !currentSession ||
        currentSession.revoked ||
        +currentSession.expiresAt < Date.now()
      )
        throw new AppError(
          401,
          "UNAUTHENTICATED",
          "La sesión ha vencido. Vuelve a identificarte y solicita ayuda a la mesa.",
        );
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
