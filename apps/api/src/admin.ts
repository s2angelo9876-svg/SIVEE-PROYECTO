import { Router } from "express";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import PDFDocument from "pdfkit";
import { validateListLogo } from "./list-logo.js";
import { db } from "./db.js";
import { config } from "./config.js";
import { schoolRoster } from "./school-roster.js";
import { registerSchoolRecords } from "./school-registration.js";
import { issueSession, adminAuth, permit, cookieOptions } from "./auth.js";
import {
  AppError,
  requireState,
  verifyPassword,
  passwordHash,
  digest,
} from "./security.js";
import {
  electionSchema,
  listSchema,
  shiftSchema,
  hasPermission,
} from "../../../packages/shared/domain.js";
import { audit, lockElection, turnout, reconcile } from "./services.js";
import {
  rosterInputSchema,
  inspectRoster,
  rosterTemplate,
} from "./roster-files.js";
import {
  previewRoster,
  importRoster,
  importHistory,
  reissueCodes,
  credentialExpiry,
} from "./roster.js";
export const admin = Router();
const dummyHash = await passwordHash("invalid-admin-password");
admin.post(
  "/auth/login",
  rateLimit({
    windowMs: 60000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  async (req, res) => {
    const { email, password, otp } = z
      .object({
        email: z.email(),
        password: z.string().min(1).max(200),
        otp: z.string().optional(),
      })
      .strict()
      .parse(req.body);
    const user = await db.admin.findUnique({
      where: { email: email.toLowerCase() },
      include: { grants: true },
    });
    const valid = await verifyPassword(
      user?.passwordHash || dummyHash,
      password,
    );
    if (!valid || !user?.active)
      throw new AppError(
        401,
        "AUTH_FAILED",
        "No pudimos verificar tus credenciales.",
      );
    if (user.mfaEnabled) {
      const { verifyTotp } = await import("./mfa.js");
      if (!otp || !user.mfaSecret || !verifyTotp(user.mfaSecret, otp))
        throw new AppError(
          401,
          "MFA_REQUIRED",
          "Ingresa el código de tu aplicación de autenticación.",
        );
    }
    const mfaSetupRequired =
      config.SIVEE_ENV === "production" && !user.mfaEnabled;
    const session = await issueSession(res, "admin", {
      adminId: user.id,
      purpose: mfaSetupRequired ? "MFA_SETUP" : "FULL",
    });
    await audit(db, user.id, null, "ADMIN_LOGIN");
    res.json({
      data: {
        ...session,
        mfaSetupRequired,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          grants: user.grants,
          mfaEnabled: user.mfaEnabled,
        },
      },
    });
  },
);
admin.use(adminAuth);
admin.use(schoolRoster);
admin.get("/me", (_req, res) => {
  const u = res.locals.admin;
  res.json({
    data: {
      id: u.id,
      name: u.name,
      email: u.email,
      grants: u.grants,
      mfaEnabled: u.mfaEnabled,
      mfaSetupRequired: res.locals.adminSession.purpose === "MFA_SETUP",
      csrfToken: res.locals.csrfToken,
    },
  });
});
admin.post("/auth/logout", async (_req, res) => {
  await db.adminSession.update({
    where: { id: res.locals.adminSession.id },
    data: { revoked: true },
  });
  res.clearCookie("sivee_admin", cookieOptions);
  res.json({ data: { ok: true } });
});
admin.get("/institution", permit("elections:read"), async (_req, res) => {
  res.json({
    data: await db.institution.findUniqueOrThrow({
      where: { id: res.locals.admin.institutionId },
    }),
  });
});
admin.post(
  "/institution/crest",
  permit("elections:write"),
  async (req, res) => {
    const { base64 } = z
      .object({
        base64: z
          .string()
          .min(1)
          .max(900000)
          .regex(/^[A-Za-z0-9+/]*={0,2}$/),
      })
      .strict()
      .parse(req.body);
    const image = Buffer.from(base64, "base64");
    requireState(
      image.length <= 600000,
      "El escudo debe ocupar como máximo 600 KB.",
    );
    const png = image
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = image[0] === 255 && image[1] === 216;
    requireState(png || jpeg, "Utiliza un escudo PNG o JPEG.");
    const document = new PDFDocument();
    document.resume();
    try {
      const raster = (document as any).openImage(image);
      requireState(
        raster.width > 0 &&
          raster.height > 0 &&
          raster.width <= 2048 &&
          raster.height <= 2048,
        "El escudo debe medir como máximo 2048 × 2048 píxeles.",
      );
      document.image(image, { width: 64 });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(400, "INVALID_IMAGE", "La imagen no es válida.");
    } finally {
      document.end();
    }
    await db.$transaction(async (tx) => {
      const institutionId = res.locals.admin.institutionId;
      await tx.institutionBranding.upsert({
        where: { institutionId },
        create: {
          institutionId,
          mime: png ? "image/png" : "image/jpeg",
          image,
        },
        update: { mime: png ? "image/png" : "image/jpeg", image },
      });
      await audit(tx, res.locals.admin.id, null, "INSTITUTION_CREST_UPDATED");
    });
    res.json({ data: { ok: true } });
  },
);
admin.patch("/institution", permit("elections:write"), async (req, res) => {
  const input = z
    .object({
      name: z.string().trim().min(5).max(150),
      code: z.string().trim().min(2).max(30),
    })
    .strict()
    .parse(req.body);
  const result = await db.$transaction(async (tx) => {
    const opened = await tx.election.count({
      where: {
        institutionId: res.locals.admin.institutionId,
        state: {
          in: ["EN_CURSO", "PAUSADA", "CERRADA", "CONCILIADA", "PUBLICADA"],
        },
      },
    });
    requireState(
      opened === 0,
      "La institución no puede cambiar durante una jornada iniciada.",
    );
    const r = await tx.institution.update({
      where: { id: res.locals.admin.institutionId },
      data: input,
    });
    await audit(tx, res.locals.admin.id, null, "INSTITUTION_UPDATED");
    return r;
  });
  res.json({ data: result });
});
admin.patch(
  "/elections/:id/windows/:shift",
  permit("elections:write"),
  async (req, res) => {
    const shift = shiftSchema.parse(req.params.shift);
    const { startsAt, endsAt } = z
      .object({
        startsAt: z.iso.datetime().nullable(),
        endsAt: z.iso.datetime().nullable(),
      })
      .strict()
      .parse(req.body);
    if (startsAt && endsAt && new Date(startsAt) >= new Date(endsAt))
      throw new AppError(
        400,
        "INVALID_SCHEDULE",
        "El fin debe ser posterior al inicio.",
      );
    const r = await db.$transaction(async (tx) => {
      const e = await lockElection(tx, String(req.params.id), true);
      requireState(e.state === "BORRADOR");
      const w = await tx.window.update({
        where: { electionId_shift: { electionId: e.id, shift } },
        data: {
          startsAt: startsAt ? new Date(startsAt) : null,
          endsAt: endsAt ? new Date(endsAt) : null,
        },
      });
      const windows = await tx.window.findMany({ where: { electionId: e.id } });
      const expiry = credentialExpiry(windows);
      await tx.credential.updateMany({
        where: { electionId: e.id, active: true, expiresAt: { lt: expiry } },
        data: { expiresAt: expiry },
      });
      await audit(tx, res.locals.admin.id, e.id, "WINDOW_SCHEDULE_UPDATED", {
        shift,
      });
      return w;
    });
    res.json({ data: r });
  },
);
admin.get("/elections", async (_req, res) => {
  const u = res.locals.admin;
  const all = await db.election.findMany({
    where: { institutionId: u.institutionId },
    orderBy: { createdAt: "desc" },
    include: { windows: true, institution: true },
  });
  res.json({
    data: all.filter((e) => hasPermission(u.grants, "elections:read", e.id)),
  });
});
admin.post("/elections", permit("elections:write"), async (req, res) => {
  const { shifts, ...input } = electionSchema.parse(req.body);
  const u = res.locals.admin;
  const authMode = input.authMode || "DESK";
  requireState(
    config.SIVEE_ENV !== "production" || authMode === "DESK",
    "Las elecciones oficiales requieren acceso con DNI.",
  );
  const e = await db.$transaction(async (tx) => {
    const e = await tx.election.create({
      data: {
        ...input,
        authMode,
        institutionId: u.institutionId,
        mode: config.SIVEE_ENV === "production" ? "OFICIAL" : "DEMO",
        windows: { create: shifts.map((shift) => ({ shift })) },
      },
    });
    await audit(tx, u.id, e.id, "ELECTION_CREATED");
    return e;
  });
  res.status(201).json({ data: e });
});
admin.get("/elections/:id", permit("elections:read"), async (req, res) => {
  const e = await db.election.findUniqueOrThrow({
    where: { id: String(req.params.id) },
    include: {
      windows: true,
      institution: true,
      approvals: { orderBy: { createdAt: "desc" } },
    },
  });
  res.json({ data: e });
});
admin.patch("/elections/:id", permit("elections:write"), async (req, res) => {
  const { shifts, ...input } = electionSchema.parse(req.body);
  const e = await db.$transaction(async (tx) => {
    const e = await lockElection(tx, String(req.params.id), true);
    requireState(e.state === "BORRADOR");
    requireState(
      !input.authMode || input.authMode === e.authMode,
      "La modalidad de identificación se fija al crear la elección.",
    );
    requireState(
      shifts.length === e.windows.length &&
        shifts.every((s) => e.windows.some((w) => w.shift === s)),
      "Los turnos se fijan al crear la elección.",
    );
    const changed = await tx.election.update({
      where: { id: e.id },
      data: input,
    });
    await audit(tx, res.locals.admin.id, e.id, "ELECTION_UPDATED");
    return changed;
  });
  res.json({ data: e });
});
admin.post(
  "/elections/:id/prepare",
  permit("elections:prepare"),
  async (req, res) => {
    const result = await db.$transaction(async (tx) => {
      const e = await lockElection(tx, String(req.params.id), true);
      requireState(e.state === "BORRADOR");
      if (e.authMode === "DESK")
        await registerSchoolRecords(tx, e, res.locals.admin.id);
      const lists = await tx.electoralList.count({
        where: { electionId: e.id, active: true },
      });
      const p = await turnout(tx, e.id);
      const credentials = await tx.credential.count({
        where: {
          electionId: e.id,
          active: true,
          expiresAt: { gt: new Date() },
        },
      });
      requireState(
        lists >= 2 && lists <= 4,
        "Se requieren entre dos y cuatro listas activas.",
      );
      requireState(p.eligible > 0, "Importa un padrón habilitado.");
      if (e.authMode === "CODE")
        requireState(
          credentials >= p.eligible,
          "Hay electores sin credenciales vigentes.",
        );
      if (e.mode === "OFICIAL")
        requireState(
          (process.env.INSTITUTIONAL_APPROVAL_REFERENCE?.trim().length || 0) >
            5,
          "Falta registrar la autorización institucional en el despliegue.",
        );
      await audit(tx, res.locals.admin.id, e.id, "ELECTION_PREPARED");
      return tx.election.update({
        where: { id: e.id },
        data: { state: "PREPARADA", version: { increment: 1 } },
      });
    });
    res.json({ data: result });
  },
);
admin.post(
  "/elections/:id/windows/:shift/:action",
  permit("windows:manage"),
  async (req, res) => {
    const shift = shiftSchema.parse(req.params.shift);
    const action = z.enum(["open", "pause", "close"]).parse(req.params.action);
    z.object({ reason: z.string().trim().min(5).max(300) })
      .strict()
      .parse(req.body);
    const result = await db.$transaction(async (tx) => {
      const e = await lockElection(tx, String(req.params.id), true);
      requireState(["PREPARADA", "EN_CURSO", "PAUSADA"].includes(e.state));
      const w = e.windows.find((w) => w.shift === shift);
      if (!w) throw new AppError(404, "NOT_FOUND", "Turno no encontrado.");
      if (action === "open") {
        requireState(["PROGRAMADA", "PAUSADA"].includes(w.state));
        requireState(
          !e.windows.some(
            (x) => x.id !== w.id && ["ABIERTA", "PAUSADA"].includes(x.state),
          ),
          "Cierra el otro turno antes de abrir este.",
        );
        if (shift === "TARDE")
          requireState(
            !e.windows.some(
              (x) => x.shift === "MANANA" && x.state !== "CERRADA",
            ),
            "Primero finaliza el turno mañana.",
          );
      }
      if (action === "pause") requireState(w.state === "ABIERTA");
      if (action === "close") requireState(w.state !== "CERRADA");
      await tx.window.update({
        where: { id: w.id },
        data: {
          state:
            action === "open"
              ? "ABIERTA"
              : action === "pause"
                ? "PAUSADA"
                : "CERRADA",
        },
      });
      const windows = await tx.window.findMany({ where: { electionId: e.id } });
      const state = windows.some((x) => x.state === "ABIERTA")
        ? "EN_CURSO"
        : "PAUSADA";
      await tx.election.update({
        where: { id: e.id },
        data: {
          state,
          openedAt: e.openedAt || new Date(),
          version: { increment: 1 },
        },
      });
      await audit(
        tx,
        res.locals.admin.id,
        e.id,
        "WINDOW_" + action.toUpperCase(),
        { shift },
      );
      return { state, windows };
    });
    res.json({ data: result });
  },
);
for (const type of ["close", "publish"] as const) {
  const permission = type === "close" ? "elections:close" : "results:publish";
  admin.post(
    `/elections/:id/${type}-request`,
    permit(permission),
    async (req, res) => {
      const { reason } = z
        .object({ reason: z.string().trim().min(5).max(300) })
        .strict()
        .parse(req.body);
      const result = await db.$transaction(async (tx) => {
        const e = await lockElection(tx, String(req.params.id), true);
        requireState(
          type === "close"
            ? ["EN_CURSO", "PAUSADA"].includes(e.state)
            : e.state === "CONCILIADA",
        );
        if (type === "close")
          requireState(
            e.windows.every((x) => x.state === "CERRADA"),
            "Cierra ambos turnos antes del cierre global.",
          );
        requireState(
          !(await tx.approval.findFirst({
            where: { electionId: e.id, type, state: "PENDING" },
          })),
          "Ya existe una solicitud pendiente.",
        );
        const a = await tx.approval.create({
          data: {
            electionId: e.id,
            type,
            requesterId: res.locals.admin.id,
            reason,
          },
        });
        await audit(
          tx,
          res.locals.admin.id,
          e.id,
          type.toUpperCase() + "_REQUESTED",
        );
        return a;
      });
      res.json({ data: result });
    },
  );
  admin.post(
    `/elections/:id/${type}-approve`,
    permit(type === "close" ? "elections:approve" : "results:approve"),
    async (req, res) => {
      const { approvalId } = z
        .object({ approvalId: z.uuid() })
        .strict()
        .parse(req.body);
      const result = await db.$transaction(async (tx) => {
        const e = await lockElection(tx, String(req.params.id), true);
        const a = await tx.approval.findFirst({
          where: { id: approvalId, electionId: e.id, type, state: "PENDING" },
        });
        requireState(!!a, "No hay una solicitud pendiente válida.");
        if (e.mode === "OFICIAL")
          requireState(
            a!.requesterId !== res.locals.admin.id,
            "La aprobación requiere otra autoridad.",
          );
        if (type === "close") {
          requireState(
            ["PAUSADA", "EN_CURSO"].includes(e.state) &&
              e.windows.every((w) => w.state === "CERRADA"),
          );
          await tx.election.update({
            where: { id: e.id },
            data: {
              state: "CERRADA",
              closedAt: new Date(),
              version: { increment: 1 },
            },
          });
        } else {
          requireState(e.state === "CONCILIADA");
          const report = await tx.report.findFirst({
            where: { electionId: e.id },
            orderBy: { version: "desc" },
          });
          requireState(
            !!report && digest(report.summary) === report.sha256,
            "El acta no supera la verificación de integridad.",
          );
          await tx.report.update({
            where: { id: report!.id },
            data: { state: "APROBADA", approvedBy: res.locals.admin.name },
          });
          await tx.election.update({
            where: { id: e.id },
            data: {
              state: "PUBLICADA",
              publishedAt: new Date(),
              version: { increment: 1 },
            },
          });
        }
        await tx.approval.update({
          where: { id: a!.id },
          data: { state: "APPROVED", approverId: res.locals.admin.id },
        });
        await audit(
          tx,
          res.locals.admin.id,
          e.id,
          type.toUpperCase() + "_APPROVED",
          { approvalId },
        );
        return { ok: true };
      });
      res.json({ data: result });
    },
  );
}
admin.post(
  "/elections/:id/reconcile",
  permit("results:reconcile"),
  async (req, res) => {
    res.json({
      data: await db.$transaction(
        (tx) => reconcile(tx, String(req.params.id), res.locals.admin.id),
        { timeout: 20000 },
      ),
    });
  },
);
admin.get(
  "/elections/:id/turnout",
  permit("turnout:read"),
  async (req, res) => {
    res.json({ data: await turnout(db, String(req.params.id)) });
  },
);
admin.get(
  "/elections/:id/roster/summary",
  permit("roster:read"),
  async (req, res) => {
    const id = String(req.params.id);
    const shifts = await db.participation.groupBy({
      by: ["shift", "state"],
      where: { electionId: id },
      _count: true,
    });
    res.json({ data: { ...(await turnout(db, id)), shifts } });
  },
);
admin.get(
  "/elections/:id/roster/template.xlsx",
  permit("roster:write"),
  async (_req, res) => {
    res.set(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.set(
      "Content-Disposition",
      'attachment; filename="plantilla-padron.xlsx"',
    );
    res.send(Buffer.from(await rosterTemplate()));
  },
);
admin.post(
  "/elections/:id/roster/file-inspect",
  permit("roster:write"),
  async (req, res) => {
    requireState(res.locals.election.state === "BORRADOR");
    res.json({ data: await inspectRoster(rosterInputSchema.parse(req.body)) });
  },
);
admin.post(
  "/elections/:id/roster/import-preview",
  permit("roster:write"),
  async (req, res) => {
    res.json({
      data: await previewRoster(
        String(req.params.id),
        rosterInputSchema.parse(req.body),
      ),
    });
  },
);
admin.post(
  "/elections/:id/roster/import-commit",
  permit("roster:write"),
  async (req, res) => {
    res.json({
      data: await importRoster(
        String(req.params.id),
        res.locals.admin.id,
        rosterInputSchema.parse(req.body),
      ),
    });
  },
);
admin.get(
  "/elections/:id/roster/imports",
  permit("roster:write"),
  async (req, res) => {
    res.json({ data: await importHistory(String(req.params.id)) });
  },
);
admin.post(
  "/elections/:id/roster/reissue",
  permit("roster:write"),
  async (req, res) => {
    const input = z
      .object({
        studentId: z.uuid().optional(),
        batchId: z.uuid().optional(),
        reason: z.string().trim().min(10).max(300),
      })
      .strict()
      .refine((v) => !!v.studentId !== !!v.batchId)
      .parse(req.body);
    res.json({
      data: await reissueCodes(
        String(req.params.id),
        res.locals.admin.id,
        input,
      ),
    });
  },
);
admin.patch(
  "/elections/:id/roster/:studentId",
  permit("roster:write"),
  async (req, res) => {
    const { enabled } = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(req.body);
    const studentId = z.uuid().parse(req.params.studentId);
    await db.$transaction(async (tx) => {
      const e = await lockElection(tx, String(req.params.id), true);
      requireState(e.state === "BORRADOR");
      await tx.participation.update({
        where: { electionId_studentId: { electionId: e.id, studentId } },
        data: { state: enabled ? "PENDIENTE" : "ANULADA_POR_COMITE" },
      });
      await tx.credential.updateMany({
        where: { electionId: e.id, studentId },
        data: { active: enabled },
      });
      await audit(tx, res.locals.admin.id, e.id, "ELIGIBILITY_UPDATED", {
        enabled,
      });
    });
    res.json({ data: { ok: true } });
  },
);
admin.post(
  "/elections/:id/roster/search",
  permit("roster:read"),
  async (req, res) => {
    const { dni } = z
      .object({ dni: z.string().regex(/^\d{8}$/) })
      .strict()
      .parse(req.body);
    const { dniLookup } = await import("./security.js");
    const student = await db.student.findUnique({
      where: {
        institutionId_dniLookup: {
          institutionId: res.locals.admin.institutionId,
          dniLookup: dniLookup(dni),
        },
      },
    });
    const p = student
      ? await db.participation.findUnique({
          where: {
            electionId_studentId: {
              electionId: String(req.params.id),
              studentId: student.id,
            },
          },
        })
      : null;
    res.json({
      data:
        p && student
          ? {
              id: student.id,
              displayName: p.displayName,
              grade: p.grade,
              section: p.section,
              shift: p.shift,
              state: p.state,
              credential: await db.credential.findUnique({
                where: {
                  electionId_studentId: {
                    electionId: String(req.params.id),
                    studentId: student.id,
                  },
                },
                select: { expiresAt: true, lockedUntil: true, active: true },
              }),
            }
          : null,
    });
  },
);
admin.get("/elections/:id/lists", permit("lists:read"), async (req, res) =>
  res.json({
    data: await db.electoralList.findMany({
      where: { electionId: String(req.params.id) },
      orderBy: { number: "asc" },
    }),
  }),
);
admin.post("/elections/:id/lists", permit("lists:write"), async (req, res) => {
  const input = listSchema.parse(req.body);
  validateListLogo(input.symbol);
  const l = await db.$transaction(async (tx) => {
    const e = await lockElection(tx, String(req.params.id), true);
    requireState(e.state === "BORRADOR");
    requireState(
      (await tx.electoralList.count({
        where: { electionId: e.id, active: true },
      })) < 4,
      "Se admiten hasta cuatro listas activas.",
    );
    const l = await tx.electoralList.create({
      data: { ...input, electionId: e.id },
    });
    await audit(tx, res.locals.admin.id, e.id, "LIST_CREATED", {
      number: l.number,
    });
    return l;
  });
  res.json({ data: l });
});
admin.patch(
  "/elections/:id/lists/:listId",
  permit("lists:write"),
  async (req, res) => {
    const input = listSchema.parse(req.body);
    validateListLogo(input.symbol);
    const listId = z.uuid().parse(req.params.listId);
    const l = await db.$transaction(async (tx) => {
      const e = await lockElection(tx, String(req.params.id), true);
      requireState(e.state === "BORRADOR");
      const existing = await tx.electoralList.findFirst({
        where: { id: listId, electionId: e.id },
      });
      if (!existing)
        throw new AppError(404, "NOT_FOUND", "Lista no encontrada.");
      if (input.active && !existing.active)
        requireState(
          (await tx.electoralList.count({
            where: { electionId: e.id, active: true },
          })) < 4,
        );
      const l = await tx.electoralList.update({
        where: { id: listId },
        data: input,
      });
      await audit(tx, res.locals.admin.id, e.id, "LIST_UPDATED", {
        number: l.number,
      });
      return l;
    });
    res.json({ data: l });
  },
);
async function publishedReport(id: string) {
  const e = await db.election.findUniqueOrThrow({ where: { id } });
  if (e.state !== "PUBLICADA")
    throw new AppError(
      403,
      "RESULTS_EMBARGOED",
      "Los resultados permanecen reservados hasta la publicación autorizada.",
    );
  const r = await db.report.findFirstOrThrow({
    where: { electionId: id, state: "APROBADA" },
    orderBy: { version: "desc" },
  });
  if (digest(r.summary) !== r.sha256)
    throw new AppError(
      409,
      "REPORT_INTEGRITY_FAILED",
      "El acta no supera la verificación de integridad.",
    );
  return r;
}
admin.get("/elections/:id/results", permit("results:read"), async (req, res) =>
  res.json({ data: await publishedReport(String(req.params.id)) }),
);
admin.get("/elections/:id/events", permit("turnout:read"), async (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  let busy = false;
  let ended = false;
  const send = async () => {
    if (busy || ended) return;
    busy = true;
    try {
      const s = await db.adminSession.findUnique({
        where: { id: res.locals.adminSession.id },
        include: { admin: { include: { grants: true } } },
      });
      if (
        !s ||
        s.revoked ||
        +s.expiresAt < Date.now() ||
        !s.admin.active ||
        !hasPermission(s.admin.grants, "turnout:read", String(req.params.id))
      ) {
        res.end();
        return;
      }
      const e = await db.election.findUniqueOrThrow({
        where: { id: String(req.params.id) },
      });
      const p = await turnout(db, e.id);
      const v = e.version * 1000000 + p.voted;
      res.write(
        `id: ${v}\nevent: turnout.updated\ndata: ${JSON.stringify({ v, ...p, state: e.state })}\n\n`,
      );
    } catch {
      res.end();
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void send(), 3000);
  req.on("close", () => {
    ended = true;
    clearInterval(timer);
  });
  await send();
});
admin.get(
  "/elections/:id/reports/final.csv",
  permit("reports:read"),
  async (req, res) => {
    const r = await publishedReport(String(req.params.id));
    const s = r.summary as any;
    const esc = (v: unknown) =>
      '"' +
      String(v)
        .replace(/^[=+@-]/, "'")
        .replaceAll('"', '""') +
      '"';
    const rows = [
      ["Concepto", "Cantidad"],
      ...s.lists.map((l: any) => [`Lista ${l.number}: ${l.name}`, l.votes]),
      ["Blancos", s.blank],
      ["Nulos", s.null],
      ["Emitidos", s.voted],
      ["Habilitados", s.eligible],
      ["Abstenciones", s.remaining],
      ["SHA256", r.sha256],
    ];
    await audit(db, res.locals.admin.id, r.electionId, "REPORT_CSV_EXPORTED");
    res
      .attachment("sivee-resultados.csv")
      .type("text/csv")
      .send("\ufeff" + rows.map((row) => row.map(esc).join(",")).join("\r\n"));
  },
);
admin.get(
  "/elections/:id/reports/final.pdf",
  permit("reports:read"),
  async (req, res) => {
    const r = await publishedReport(String(req.params.id));
    const s = r.summary as any;
    const branding = await db.institutionBranding.findUnique({
      where: { institutionId: res.locals.admin.institutionId },
    });
    await audit(db, res.locals.admin.id, r.electionId, "REPORT_PDF_EXPORTED");
    res.attachment("sivee-acta-final.pdf").type("application/pdf");
    const doc = new PDFDocument({
      margin: 48,
      size: "A4",
      info: { Title: "SIVEE · Acta de escrutinio" },
    });
    doc.pipe(res);
    if (branding)
      doc.image(Buffer.from(branding.image), 480, 42, { fit: [60, 80] });
    doc.fillColor("#0b1f3a").fontSize(27).text("SIVEE");
    doc.fontSize(11).text("SISTEMA DE VOTACIÓN ELECTRÓNICA ESCOLAR");
    doc.moveDown(2);
    doc.fillColor("#b91c2b").fontSize(20).text("Acta de escrutinio");
    doc.fillColor("#0b1f3a");
    doc.fontSize(12).text(s.electionName).text(s.institution).moveDown();
    doc
      .fontSize(10)
      .text(`Modalidad: ${s.mode} · Versión ${r.version} · ${r.state}`)
      .text(`Identificador: ${r.id}`)
      .text(
        `Emisión: ${new Date(r.createdAt).toLocaleString("es-PE", { timeZone: "America/Lima" })}`,
      )
      .moveDown();
    for (const [label, value] of [
      ["Habilitados", s.eligible],
      ["Participantes", s.voted],
      ["Abstenciones", s.remaining],
      ["Válidos", s.valid],
      ["Blancos", s.blank],
      ["Nulos", s.null],
    ])
      doc.fontSize(12).text(`${label}: ${value}`);
    doc.moveDown();
    for (const l of s.lists)
      doc.text(`Lista ${l.number} · ${l.name}: ${l.votes}`);
    doc
      .moveDown()
      .fontSize(11)
      .text(
        `Conciliación: ${s.voted} = ${s.valid} + ${s.blank} + ${s.null}. Verificada.`,
      )
      .text(`Resultado: ${s.outcome.status}. Sujeto a proclamación del Comité.`)
      .moveDown();
    doc
      .fontSize(9)
      .text(`Aprobación en sistema: ${r.approvedBy}`)
      .text("SHA-256 del resumen canónico:")
      .fontSize(8)
      .text(r.sha256)
      .moveDown(3);
    doc
      .fontSize(11)
      .text("_________________________          _________________________")
      .text("Comité Electoral                                  Dirección")
      .moveDown(2);
    doc
      .fontSize(9)
      .text(
        s.mode === "OFICIAL"
          ? "Acta del proceso electoral. La proclamación corresponde al Comité Electoral."
          : "SIMULACIÓN con datos ficticios. Esta acta no certifica una elección oficial.",
      );
    doc.end();
  },
);
admin.get("/elections/:id/audit", permit("audit:read"), async (req, res) =>
  res.json({
    data: await db.audit.findMany({
      where: { electionId: String(req.params.id) },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { admin: { select: { name: true } } },
    }),
  }),
);
admin.get(
  "/elections/:id/audit/export",
  permit("audit:read"),
  async (req, res) => {
    const records = await db.audit.findMany({
      where: { electionId: String(req.params.id) },
      orderBy: { createdAt: "asc" },
    });
    await audit(
      db,
      res.locals.admin.id,
      String(req.params.id),
      "AUDIT_EXPORTED",
    );
    res.attachment("sivee-auditoria.json").json({ records });
  },
);
admin.get(
  "/elections/:id/incidents",
  permit("incidents:read"),
  async (req, res) =>
    res.json({
      data: await db.incident.findMany({
        where: { electionId: String(req.params.id) },
        orderBy: { createdAt: "desc" },
      }),
    }),
);
admin.post(
  "/elections/:id/incidents",
  permit("incidents:write"),
  async (req, res) => {
    const input = z
      .object({
        shift: shiftSchema,
        type: z.enum(["CONECTIVIDAD", "EQUIPO", "PADRON", "OPERACION", "OTRO"]),
        severity: z.enum(["BAJA", "MEDIA", "ALTA"]),
        description: z
          .string()
          .trim()
          .min(10)
          .max(1000)
          .refine(
            (v) => !/[<>]|\b\d{8}\b/.test(v),
            "No incluyas documentos personales ni etiquetas HTML.",
          ),
      })
      .strict()
      .parse(req.body);
    const r = await db.$transaction(async (tx) => {
      const r = await tx.incident.create({
        data: {
          ...input,
          electionId: String(req.params.id),
          createdBy: res.locals.admin.id,
        },
      });
      await audit(
        tx,
        res.locals.admin.id,
        String(req.params.id),
        "INCIDENT_CREATED",
        { severity: input.severity, type: input.type },
      );
      return r;
    });
    res.json({ data: r });
  },
);
admin.patch(
  "/elections/:id/incidents/:incidentId",
  permit("incidents:write"),
  async (req, res) => {
    const { state } = z
      .object({ state: z.enum(["ABIERTO", "RESUELTO"]) })
      .strict()
      .parse(req.body);
    const incidentId = z.uuid().parse(req.params.incidentId);
    const r = await db.incident.updateMany({
      where: { id: incidentId, electionId: String(req.params.id) },
      data: { state },
    });
    if (!r.count)
      throw new AppError(404, "NOT_FOUND", "Incidencia no encontrada.");
    await audit(
      db,
      res.locals.admin.id,
      String(req.params.id),
      "INCIDENT_UPDATED",
      { state },
    );
    res.json({ data: { ok: true } });
  },
);
admin.post("/demo/:id/reset", permit("demo:reset"), async (req, res) => {
  z.object({ confirmation: z.literal("NUEVA SIMULACION") })
    .strict()
    .parse(req.body);
  requireState(
    config.SIVEE_ENV === "demo" && config.ALLOW_DEMO_RESET === "true",
    "El reinicio solo está habilitado en DEMO.",
  );
  const result = await db.$transaction(
    async (tx) => {
      const old = await lockElection(tx, String(req.params.id), true);
      requireState(old.mode === "DEMO" && old.authMode === "CODE");
      const lists = await tx.electoralList.findMany({
        where: { electionId: old.id },
      });
      const roster = await tx.participation.findMany({
        where: { electionId: old.id },
      });
      const credentials = await tx.credential.findMany({
        where: { electionId: old.id },
      });
      const e = await tx.election.create({
        data: {
          institutionId: old.institutionId,
          name: old.name,
          year: old.year,
          scope: old.scope,
          blankAllowed: old.blankAllowed,
          nullAllowed: old.nullAllowed,
          regulation: old.regulation,
          contact: old.contact,
          mode: "DEMO",
          windows: { create: old.windows.map((w) => ({ shift: w.shift })) },
        },
      });
      for (const l of lists) {
        const { id: _id, electionId: _e, ...data } = l;
        await tx.electoralList.create({
          data: {
            ...data,
            candidates: data.candidates as any,
            electionId: e.id,
          },
        });
      }
      for (const p of roster)
        await tx.participation.create({
          data: {
            electionId: e.id,
            studentId: p.studentId,
            shift: p.shift,
            displayName: p.displayName,
            grade: p.grade,
            section: p.section,
            state:
              p.state === "ANULADA_POR_COMITE"
                ? "ANULADA_POR_COMITE"
                : "PENDIENTE",
          },
        });
      for (const c of credentials)
        await tx.credential.create({
          data: {
            electionId: e.id,
            studentId: c.studentId,
            codeHash: c.codeHash,
            active: c.active,
            expiresAt: new Date(Date.now() + 30 * 86400000),
          },
        });
      await tx.window.updateMany({
        where: { electionId: old.id },
        data: { state: "CERRADA" },
      });
      await tx.election.update({
        where: { id: old.id },
        data: { state: "ANULADA", version: { increment: 1 } },
      });
      await tx.voterSession.updateMany({
        where: { electionId: old.id },
        data: { revoked: true },
      });
      await audit(tx, res.locals.admin.id, old.id, "DEMO_REPLACED", {
        newElectionId: e.id,
      });
      await audit(tx, res.locals.admin.id, e.id, "DEMO_CREATED_FROM_PREVIOUS");
      return e;
    },
    { timeout: 60000 },
  );
  res.json({ data: result });
});
