import crypto from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db.js";
import { config } from "./config.js";
import { permit } from "./auth.js";
import { audit, lockElection } from "./services.js";
import { AppError, digest, requireState } from "./security.js";
import { hasPermission } from "../../../packages/shared/domain.js";

// Different key domain from document encryption; snapshots contain private roster data.
const key = crypto
  .createHash("sha256")
  .update("sivee-election-copy-v1:")
  .update(config.SESSION_PEPPER)
  .digest();
function seal(value: unknown) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), data]
    .map((b) => b.toString("base64url"))
    .join(".");
}
function open(value: string): unknown {
  const [iv, tag, data] = value
    .split(".")
    .map((s) => Buffer.from(s, "base64url"));
  const cipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  cipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8"),
  );
}
const text = z.string();
const payloadSchema = z.object({
  format: z.literal(1),
  institutionId: z.uuid(),
  electionId: z.uuid(),
  settings: z.object({
    name: text,
    year: z.number().int(),
    scope: text,
    mode: z.enum(["DEMO", "OFICIAL"]),
    blankAllowed: z.boolean(),
    nullAllowed: z.boolean(),
    regulation: text,
    contact: text,
  }),
  reference: text,
  windows: z
    .array(
      z.object({
        shift: z.enum(["MANANA", "TARDE"]),
        startsAt: z.iso.datetime().nullable(),
        endsAt: z.iso.datetime().nullable(),
      }),
    )
    .min(1)
    .max(2),
  lists: z.array(
    z.object({
      number: z.number().int(),
      name: text,
      symbol: text,
      color: text,
      candidates: z.json(),
      proposal: text,
      active: z.boolean(),
    }),
  ),
  schoolRows: z
    .array(
      z.object({
        studentCode: text,
        sourceRow: z.number().int(),
        documentEncrypted: text,
        displayName: text,
        grade: text,
        section: text,
        shift: text.nullable(),
        enrollment: text,
        enrollmentApproved: z.boolean(),
        isForeign: z.boolean(),
        excluded: z.boolean(),
        reason: text,
        registered: z.boolean(),
      }),
    )
    .max(5000),
  roster: z
    .array(
      z.object({
        studentId: z.uuid(),
        shift: text,
        displayName: text,
        grade: text,
        section: text,
        enabled: z.boolean(),
      }),
    )
    .max(5000),
});
const metadata = {
  id: true,
  electionId: true,
  label: true,
  summary: true,
  createdAt: true,
} as const;
const root = "/elections/:id/copies";
export const electionCopies = Router();
// A copy includes configuration, lists and private roster data. Require all three scopes.
electionCopies.use(
  root,
  permit("elections:write"),
  permit("roster:write"),
  permit("lists:write"),
);
electionCopies.get(root, async (req, res) => {
  res.json({
    data: await db.electionCopy.findMany({
      where: { electionId: String(req.params.id) },
      select: metadata,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 20,
    }),
  });
});
electionCopies.post(root, async (req, res) => {
  const { requestId, label } = z
    .object({ requestId: z.uuid(), label: z.string().trim().min(3).max(100) })
    .strict()
    .parse(req.body);
  const result = await db.$transaction(
    async (tx) => {
      const e = await lockElection(tx, String(req.params.id), true);
      const existing = await tx.electionCopy.findUnique({
        where: { id: requestId },
        select: { ...metadata, adminId: true },
      });
      if (existing) {
        requireState(
          existing.electionId === e.id &&
            existing.adminId === res.locals.admin.id &&
            existing.label === label,
          "El identificador pertenece a otra copia.",
        );
        const { adminId: _adminId, ...saved } = existing;
        return saved;
      }
      requireState(
        e.authMode === "DESK" && e.state !== "ANULADA",
        "Las copias requieren una elección con acceso por DNI o matrícula que no esté anulada.",
      );
      const [lists, schoolRows, roster, reference] = await Promise.all([
        tx.electoralList.findMany({
          where: { electionId: e.id },
          orderBy: { number: "asc" },
        }),
        tx.schoolDraft.findMany({
          where: { electionId: e.id },
          orderBy: { id: "asc" },
        }),
        tx.participation.findMany({
          where: { electionId: e.id },
          orderBy: { studentId: "asc" },
        }),
        tx.approval.findFirst({
          where: {
            electionId: e.id,
            type: "institutional-reference",
            state: "RECORDED",
          },
        }),
      ]);
      const payload = payloadSchema.parse({
        format: 1,
        institutionId: e.institutionId,
        electionId: e.id,
        settings: {
          name: e.name,
          year: e.year,
          scope: e.scope,
          mode: e.mode,
          blankAllowed: e.blankAllowed,
          nullAllowed: e.nullAllowed,
          regulation: e.regulation,
          contact: e.contact,
        },
        reference: reference?.reason || "",
        windows: e.windows.map((w) => ({
          shift: w.shift,
          startsAt: w.startsAt?.toISOString() || null,
          endsAt: w.endsAt?.toISOString() || null,
        })),
        lists: lists.map(({ id: _id, electionId: _electionId, ...l }) => l),
        schoolRows: schoolRows.map(
          ({
            id: _id,
            electionId: _electionId,
            batchId: _batchId,
            version: _version,
            publishedAt,
            ...r
          }) => ({ ...r, registered: !!publishedAt }),
        ),
        roster: roster.map(
          ({ studentId, shift, displayName, grade, section, state }) => ({
            studentId,
            shift,
            displayName,
            grade,
            section,
            enabled: state !== "ANULADA_POR_COMITE",
          }),
        ),
      });
      const summary = {
        name: e.name,
        rows: schoolRows.length,
        eligible: roster.filter((p) => p.state !== "ANULADA_POR_COMITE").length,
        foreign: schoolRows.filter((r) => r.isForeign).length,
        lists: lists.length,
        shifts: e.windows.map((w) => w.shift),
      };
      const saved = await tx.electionCopy.create({
        data: {
          id: requestId,
          electionId: e.id,
          adminId: res.locals.admin.id,
          label,
          payloadEncrypted: seal(payload),
          sha256: digest(payload),
          summary,
        },
        select: metadata,
      });
      await audit(tx, res.locals.admin.id, e.id, "ELECTION_COPY_SAVED", {
        copyId: saved.id,
        rows: schoolRows.length,
        lists: lists.length,
      });
      return saved;
    },
    { timeout: 60000 },
  );
  res.status(201).json({ data: result });
});
electionCopies.post(root + "/:copyId/recover", async (req, res) => {
  const input = z
    .object({
      requestId: z.uuid(),
      name: z.string().trim().min(5).max(150),
      confirmation: z.literal("CREAR NUEVA ELECCION"),
    })
    .strict()
    .parse(req.body);
  const copyId = z.uuid().parse(req.params.copyId),
    sourceId = String(req.params.id),
    user = res.locals.admin;
  // Creating the destination must not extend an election-specific grant to a new election.
  if (
    !["elections:write", "roster:write", "lists:write"].every((permission) =>
      hasPermission(user.grants, permission),
    )
  ) {
    await audit(db, user.id, sourceId, "ACCESS_DENIED", {
      permission: "election-copy:recover",
    });
    throw new AppError(
      403,
      "FORBIDDEN",
      "Recuperar como nueva elección requiere permisos para todas las elecciones de la institución.",
    );
  }
  const requestHash = digest({ copyId, name: input.name });
  const result = await db.$transaction(
    async (tx) => {
      // Serialize recovery with operations on existing elections, including opening a shift.
      await tx.$queryRaw`SELECT id FROM elections WHERE "institutionId"=${user.institutionId}::uuid ORDER BY id FOR UPDATE`;
      const copy = await tx.electionCopy.findFirst({
        where: { id: copyId, electionId: sourceId },
      });
      if (!copy) throw new AppError(404, "NOT_FOUND", "Copia no encontrada.");
      const previous = await tx.electionCopyRecovery.findUnique({
        where: { requestId: input.requestId },
      });
      if (previous) {
        requireState(
          previous.copyId === copyId &&
            previous.adminId === user.id &&
            previous.requestHash === requestHash,
          "El identificador pertenece a otra recuperación.",
        );
        return tx.election.findUniqueOrThrow({
          where: { id: previous.electionId },
          select: { id: true, name: true, state: true },
        });
      }
      requireState(
        !(await tx.election.count({
          where: {
            institutionId: user.institutionId,
            state: { in: ["PREPARADA", "EN_CURSO", "PAUSADA"] },
          },
        })),
        "Finaliza el cierre global de las elecciones preparadas o en curso antes de recuperar una copia.",
      );
      let payload: z.infer<typeof payloadSchema>;
      try {
        payload = payloadSchema.parse(open(copy.payloadEncrypted));
        if (
          digest(payload) !== copy.sha256 ||
          payload.institutionId !== user.institutionId ||
          payload.electionId !== sourceId
        )
          throw new Error("Invalid copy");
      } catch {
        throw new AppError(
          409,
          "COPY_INVALID",
          "No se pudo verificar la copia. No se ha creado ninguna elección.",
        );
      }
      // Keep institution-wide student deactivations; do not create or modify identities.
      const students = await tx.student.findMany({
        where: {
          institutionId: user.institutionId,
          id: { in: payload.roster.map((p) => p.studentId) },
        },
        select: { id: true, active: true },
      });
      requireState(
        students.length === payload.roster.length,
        "El padrón de la copia no coincide con los estudiantes de la institución.",
      );
      const active = new Set(students.filter((s) => s.active).map((s) => s.id));
      const e = await tx.election.create({
        data: {
          ...payload.settings,
          mode:
            config.SIVEE_ENV === "production"
              ? "OFICIAL"
              : payload.settings.mode,
          name: input.name,
          institutionId: user.institutionId,
          authMode: "DESK",
          state: "BORRADOR",
          windows: {
            create: payload.windows.map((w) => ({
              ...w,
              startsAt: w.startsAt ? new Date(w.startsAt) : null,
              endsAt: w.endsAt ? new Date(w.endsAt) : null,
            })),
          },
        },
        select: { id: true, name: true, state: true },
      });
      if (payload.lists.length)
        await tx.electoralList.createMany({
          data: payload.lists.map((l) => ({
            ...l,
            candidates: l.candidates as Prisma.InputJsonValue,
            electionId: e.id,
          })),
        });
      if (payload.schoolRows.length) {
        const batchId = crypto.randomUUID();
        await tx.schoolImport.create({
          data: {
            id: batchId,
            electionId: e.id,
            adminId: user.id,
            source: "Copia de configuración",
            payloadHash: copy.sha256,
            total: payload.schoolRows.length,
          },
        });
        await tx.schoolDraft.createMany({
          data: payload.schoolRows.map(({ registered, ...row }) => ({
            ...row,
            electionId: e.id,
            batchId,
            publishedAt: registered ? new Date() : null,
          })),
        });
      }
      if (payload.roster.length)
        await tx.participation.createMany({
          data: payload.roster.map(({ enabled, ...p }) => ({
            ...p,
            electionId: e.id,
            state:
              enabled && active.has(p.studentId)
                ? "PENDIENTE"
                : "ANULADA_POR_COMITE",
          })),
        });
      if (payload.reference)
        await tx.approval.create({
          data: {
            electionId: e.id,
            type: "institutional-reference",
            state: "RECORDED",
            requesterId: user.id,
            reason: payload.reference,
          },
        });
      await tx.electionCopyRecovery.create({
        data: {
          requestId: input.requestId,
          copyId,
          electionId: e.id,
          adminId: user.id,
          requestHash,
        },
      });
      await audit(tx, user.id, sourceId, "ELECTION_COPY_RECOVERED", {
        copyId,
        newElectionId: e.id,
      });
      await audit(tx, user.id, e.id, "ELECTION_CREATED_FROM_COPY", {
        copyId,
        sourceElectionId: sourceId,
      });
      return e;
    },
    { timeout: 60000 },
  );
  res.status(201).json({ data: result });
});
