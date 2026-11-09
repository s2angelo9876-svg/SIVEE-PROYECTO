import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { db } from "./db.js";
import { permit } from "./auth.js";
import { audit, lockElection, type Tx } from "./services.js";
import {
  AppError,
  requireState,
  hashSecret,
  canonical,
  dniLookup,
} from "./security.js";
import { decryptDocument, encryptDocument } from "./private-data.js";
import {
  parseSchoolFile,
  schoolIssues,
  schoolRowSchema,
  schoolSourceSchema,
  schoolTemplate,
} from "./school-files.js";

export const schoolRoster = Router();
const root = "/elections/:id/roster/school";
const reasonSchema = z.string().trim().min(10).max(300);
async function draftElection(tx: Tx, id: string) {
  const election = await lockElection(tx, id, true);
  requireState(
    election.state === "BORRADOR" && election.authMode === "DESK",
    "Esta elección no admite cambios en el padrón escolar.",
  );
  return election;
}
async function drafts(tx: Tx, id: string) {
  const rows = await tx.schoolDraft.findMany({
    where: { electionId: id },
    orderBy: [{ grade: "asc" }, { section: "asc" }, { displayName: "asc" }],
  });
  const decoded = rows.map(({ documentEncrypted, ...r }) => ({
    ...r,
    document: decryptDocument(documentEncrypted),
  }));
  const documents = new Map<string, number>();
  decoded
    .filter((r) => !r.excluded && r.document)
    .forEach((r) =>
      documents.set(r.document, (documents.get(r.document) || 0) + 1),
    );
  return decoded.map((r) => ({
    ...r,
    issues: [
      ...schoolIssues(r),
      ...(!r.excluded && r.document && documents.get(r.document)! > 1
        ? ["Documento repetido en el borrador."]
        : []),
    ],
  }));
}
schoolRoster.get(
  root + "/template.xlsx",
  permit("roster:write"),
  async (_req, res) => {
    res
      .attachment("padron-colegio.xlsx")
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .send(Buffer.from(await schoolTemplate()));
  },
);
schoolRoster.get(root, permit("roster:write"), async (req, res) => {
  const id = String(req.params.id),
    rows = await drafts(db, id);
  const history = await db.schoolImport.findMany({
    where: { electionId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, source: true, total: true, createdAt: true },
  });
  res.json({
    data: {
      rows: rows.map(({ document, ...r }) => ({
        ...r,
        document: document ? "••••" + document.slice(-4) : "Sin documento",
      })),
      history,
      total: rows.length,
      pending: rows.filter((r) => !r.publishedAt && r.issues.length).length,
      ready: rows.filter(
        (r) => !r.publishedAt && !r.excluded && !r.issues.length,
      ).length,
      excluded: rows.filter((r) => r.excluded).length,
      published: rows.filter((r) => r.publishedAt && !r.excluded).length,
    },
  });
});
schoolRoster.get(
  root + "/rows/:rowId",
  permit("roster:write"),
  async (req, res) => {
    const row = await db.schoolDraft.findFirst({
      where: {
        id: z.uuid().parse(req.params.rowId),
        electionId: String(req.params.id),
      },
    });
    if (!row) throw new AppError(404, "NOT_FOUND", "Registro no encontrado.");
    const { documentEncrypted, ...r } = row;
    res.json({ data: { ...r, document: decryptDocument(documentEncrypted) } });
  },
);
schoolRoster.post(
  root + "/preview",
  permit("roster:write"),
  async (req, res) => {
    requireState(
      res.locals.election.state === "BORRADOR" &&
        res.locals.election.authMode === "DESK",
    );
    const parsed = await parseSchoolFile(schoolSourceSchema.parse(req.body));
    const rows = parsed.rows.map((r) => ({ ...r, issues: schoolIssues(r) }));
    res.json({
      data: {
        total: rows.length,
        pending: rows.filter((r) => r.issues.length).length,
        warnings: parsed.warnings,
        rows: rows.map(({ document, ...r }) => ({
          ...r,
          document: document ? "••••" + document.slice(-4) : "Sin documento",
        })),
      },
    });
  },
);
schoolRoster.post(
  root + "/import",
  permit("roster:write"),
  async (req, res) => {
    const input = schoolSourceSchema.parse(req.body),
      parsed = await parseSchoolFile(input);
    const payloadHash = hashSecret(canonical(parsed.rows)),
      id = String(req.params.id);
    const result = await db.$transaction(async (tx) => {
      await draftElection(tx, id);
      const previous = await tx.schoolImport.findUnique({
        where: { id: input.requestId },
      });
      if (previous) {
        requireState(
          previous.electionId === id && previous.payloadHash === payloadHash,
          "El identificador pertenece a otra carga.",
        );
        return { count: previous.total, alreadyImported: true };
      }
      const collision = await tx.schoolDraft.findFirst({
        where: {
          electionId: id,
          studentCode: { in: parsed.rows.map((r) => r.studentCode) },
        },
      });
      requireState(
        !collision,
        "Hay referencias de matrícula ya cargadas. Consulta y corrige el borrador existente.",
      );
      await tx.schoolImport.create({
        data: {
          id: input.requestId,
          electionId: id,
          adminId: res.locals.admin.id,
          source:
            input.file?.name ||
            (input.individual ? "Registro individual" : "CSV escolar"),
          payloadHash,
          total: parsed.rows.length,
        },
      });
      await tx.schoolDraft.createMany({
        data: parsed.rows.map(({ document, ...r }) => ({
          ...r,
          electionId: id,
          batchId: input.requestId,
          documentEncrypted: encryptDocument(document),
        })),
      });
      await audit(tx, res.locals.admin.id, id, "SCHOOL_ROSTER_STAGED", {
        batchId: input.requestId,
        count: parsed.rows.length,
      });
      return { count: parsed.rows.length, alreadyImported: false };
    });
    res.json({ data: result });
  },
);
schoolRoster.patch(
  root + "/rows/:rowId",
  permit("roster:write"),
  async (req, res) => {
    const input = schoolRowSchema
      .extend({
        version: z.number().int().positive(),
        enrollmentApproved: z.boolean(),
        excluded: z.boolean(),
        reason: reasonSchema,
      })
      .strict()
      .parse(req.body);
    const { version, reason, document, ...data } = input;
    await db.$transaction(async (tx) => {
      const e = await draftElection(tx, String(req.params.id));
      const row = await tx.schoolDraft.findFirst({
        where: { id: z.uuid().parse(req.params.rowId), electionId: e.id },
      });
      requireState(
        !!row && !row.publishedAt && row.version === version,
        "El registro cambió o ya fue confirmado. Actualiza la pantalla.",
      );
      await tx.schoolDraft.update({
        where: { id: row!.id },
        data: {
          ...data,
          documentEncrypted: encryptDocument(document),
          reason,
          version: { increment: 1 },
        },
      });
      await audit(tx, res.locals.admin.id, e.id, "SCHOOL_ROSTER_CORRECTED", {
        rowId: row!.id,
        reason,
        excluded: data.excluded,
        enrollmentApproved: data.enrollmentApproved,
      });
    });
    res.json({ data: { ok: true } });
  },
);
schoolRoster.post(
  root + "/publish",
  permit("roster:write"),
  async (req, res) => {
    const { reason, updateProfiles } = z
      .object({
        reason: reasonSchema,
        updateProfiles: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    const result = await db.$transaction(
      async (tx) => {
        const e = await draftElection(tx, String(req.params.id)),
          all = await drafts(tx, e.id);
        const pending = all.filter((r) => !r.publishedAt);
        requireState(
          pending.length > 0,
          "No hay registros nuevos por confirmar.",
        );
        requireState(
          !pending.some((r) => r.issues.length),
          "Resuelve los documentos, matrículas y duplicados pendientes antes de confirmar.",
        );
        const accepted = pending.filter((r) => !r.excluded);
        const existing = await tx.student.findMany({
          where: {
            institutionId: e.institutionId,
            dniLookup: { in: accepted.map((r) => dniLookup(r.document)) },
          },
          include: { participations: { where: { electionId: e.id } } },
        });
        const byDni = new Map(existing.map((s) => [s.dniLookup, s]));
        const students = [],
          participations = [];
        let updated = 0;
        for (const r of accepted) {
          const key = dniLookup(r.document),
            old = byDni.get(key);
          requireState(
            !old || (old.active && !old.participations.length),
            `Fila ${r.sourceRow}: el estudiante ya está inscrito o está inactivo en la institución.`,
          );
          const profile = {
            displayName: r.displayName,
            grade: r.grade,
            section: r.section,
            // Legacy storage field only; DNI access does not depend on this value.
            shift: r.shift ?? old?.shift ?? e.windows[0].shift,
          };
          const id = old?.id || crypto.randomUUID();
          if (old) {
            const changed = Object.entries(profile).some(
              ([field, value]) => old[field as keyof typeof profile] !== value,
            );
            requireState(
              !changed || updateProfiles,
              "Hay datos institucionales distintos. Confirma explícitamente su actualización; se conserva el historial de otras elecciones.",
            );
            if (changed) {
              await tx.student.update({ where: { id }, data: profile });
              updated++;
            }
          } else
            students.push({
              id,
              institutionId: e.institutionId,
              dniLookup: key,
              ...profile,
            });
          participations.push({ electionId: e.id, studentId: id, ...profile });
        }
        if (students.length) await tx.student.createMany({ data: students });
        if (participations.length)
          await tx.participation.createMany({ data: participations });
        await tx.schoolDraft.updateMany({
          where: { electionId: e.id, id: { in: pending.map((r) => r.id) } },
          data: { publishedAt: new Date(), version: { increment: 1 } },
        });
        await audit(tx, res.locals.admin.id, e.id, "SCHOOL_ROSTER_CONFIRMED", {
          count: accepted.length,
          excluded: pending.length - accepted.length,
          updatedProfiles: updated,
          reason,
        });
        return {
          count: accepted.length,
          excluded: pending.length - accepted.length,
        };
      },
      { timeout: 60000 },
    );
    res.json({ data: result });
  },
);
