import { Router } from "express";
import { z } from "zod";
import { db } from "./db.js";
import { permit } from "./auth.js";
import { audit, lockElection, type Tx } from "./services.js";
import { AppError, requireState, hashSecret, canonical } from "./security.js";
import { decryptDocument, encryptDocument } from "./private-data.js";
import { schoolRecords, registerSchoolRecords } from "./school-registration.js";
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
    rows = await schoolRecords(db, id);
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
        foreignCandidate:
          !r.isForeign &&
          !r.publishedAt &&
          !r.excluded &&
          !/^\d{8}$/.test(document),
        document: document ? "••••" + document.slice(-4) : "Sin documento",
      })),
      history,
      total: rows.length,
      eligible: await db.participation.count({
        where: { electionId: id, state: { in: ["PENDIENTE", "VOTO_EMITIDO"] } },
      }),
      unavailable: rows.filter((r) => !r.publishedAt && !r.excluded).length,
      excluded: rows.filter((r) => r.excluded).length,
      foreign: rows.filter((r) => r.isForeign).length,
      shifts: {
        MANANA: rows.filter((r) => r.shift === "MANANA").length,
        TARDE: rows.filter((r) => r.shift === "TARDE").length,
        UNKNOWN: rows.filter((r) => !r.shift).length,
      },
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
    const counts = new Map<string, number>();
    for (const r of parsed.rows)
      if (r.document) counts.set(r.document, (counts.get(r.document) || 0) + 1);
    const rows = parsed.rows.map((r) => ({
      ...r,
      issues: [
        ...schoolIssues(r),
        ...(r.document && counts.get(r.document)! > 1
          ? ["DNI repetido; no se crea otra inscripción."]
          : []),
      ],
    }));
    res.json({
      data: {
        total: rows.length,
        unavailable: rows.filter((r) => r.issues.length).length,
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
  root + "/foreign-students",
  permit("roster:write"),
  async (req, res) => {
    const { rowIds, reason } = z
      .object({
        rowIds: z
          .array(z.uuid())
          .min(1)
          .max(5000)
          .refine((ids) => new Set(ids).size === ids.length),
        reason: reasonSchema,
      })
      .strict()
      .parse(req.body);
    const result = await db.$transaction(
      async (tx) => {
        const e = await lockElection(tx, String(req.params.id), true);
        requireState(
          e.authMode === "DESK" &&
            ["BORRADOR", "PREPARADA", "EN_CURSO", "PAUSADA"].includes(e.state),
          "La elección no admite habilitar estos registros.",
        );
        const rows = await tx.schoolDraft.findMany({
          where: { electionId: e.id, id: { in: rowIds } },
        });
        requireState(
          rows.length === rowIds.length &&
            rows.every(
              (r) =>
                !r.excluded &&
                (r.isForeign ||
                  (!r.publishedAt &&
                    !/^\d{8}$/.test(decryptDocument(r.documentEncrypted)))),
            ),
          "Selecciona únicamente los registros ya cargados sin DNI habilitado.",
        );
        const changed = await tx.schoolDraft.updateMany({
          where: { electionId: e.id, id: { in: rowIds }, isForeign: false },
          data: { isForeign: true, reason, version: { increment: 1 } },
        });
        const registered = await registerSchoolRecords(
          tx,
          e,
          res.locals.admin.id,
          rowIds,
        );
        if (changed.count || registered.count) {
          await tx.election.update({
            where: { id: e.id },
            data: { version: { increment: 1 } },
          });
          await audit(
            tx,
            res.locals.admin.id,
            e.id,
            "FOREIGN_STUDENTS_DECLARED",
            {
              rowIds,
              count: changed.count,
              registered: registered.count,
              reason,
            },
          );
        }
        return { classified: changed.count, registered: registered.count };
      },
      { timeout: 60000 },
    );
    res.json({ data: result });
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
    const result = await db.$transaction(
      async (tx) => {
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
          "Hay referencias de matrícula ya cargadas. Consulta y corrige el registro existente.",
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
        await audit(tx, res.locals.admin.id, id, "SCHOOL_ROSTER_IMPORTED", {
          batchId: input.requestId,
          count: parsed.rows.length,
        });
        const registration = await registerSchoolRecords(
          tx,
          await tx.election.findUniqueOrThrow({
            where: { id },
            include: { windows: true },
          }),
          res.locals.admin.id,
        );
        return {
          count: parsed.rows.length,
          eligible: registration.count,
          alreadyImported: false,
        };
      },
      { timeout: 60000 },
    );
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
        enrollmentApproved: z.boolean().default(false),
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
        "El registro cambió o ya está habilitado. Actualiza la pantalla.",
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
      await registerSchoolRecords(tx, e, res.locals.admin.id);
    });
    res.json({ data: { ok: true } });
  },
);
schoolRoster.post(
  root + "/register",
  permit("roster:write"),
  async (req, res) => {
    const result = await db.$transaction(
      async (tx) => {
        const e = await draftElection(tx, String(req.params.id));
        return registerSchoolRecords(tx, e, res.locals.admin.id);
      },
      { timeout: 60000 },
    );
    res.json({ data: result });
  },
);
