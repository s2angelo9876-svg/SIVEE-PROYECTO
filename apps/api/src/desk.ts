import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { db } from "./db.js";
import { cookieOptions, csrf, issueSession, permit } from "./auth.js";
import { audit, lockElection, windowAvailable, type Tx } from "./services.js";
import {
  AppError,
  requireState,
  newToken,
  hashSecret,
  csrfFor,
  dniLookup,
} from "./security.js";
import { hasPermission } from "../../../packages/shared/domain.js";
import { config } from "./config.js";

export const deskAdmin = Router(),
  boothApi = Router();
const root = "/elections/:id/desk";
const activeStates = ["BORRADOR", "PREPARADA", "EN_CURSO", "PAUSADA"];
const reasonSchema = z.string().trim().min(10).max(300);
async function expire(tx: Tx, electionId: string) {
  const rows = await tx.admission.findMany({
    where: {
      electionId,
      state: { in: ["WAITING", "APPROVED"] },
      expiresAt: { lte: new Date() },
    },
    select: { id: true },
  });
  if (!rows.length) return;
  const ids = rows.map((r) => r.id);
  await tx.admission.updateMany({
    where: { id: { in: ids } },
    data: { state: "EXPIRED" },
  });
  await tx.voterSession.updateMany({
    where: { admissionId: { in: ids } },
    data: { revoked: true },
  });
}
function deskScope(
  user: any,
  booth: { electionId: string; assignedAdminId: string },
) {
  if (
    booth.assignedAdminId !== user.id &&
    !hasPermission(user.grants, "desk:manage", booth.electionId)
  )
    throw new AppError(
      403,
      "FORBIDDEN",
      "Esta cabina está asignada a otra mesa.",
    );
}
async function assignedAdmin(
  tx: Tx,
  adminId: string,
  institutionId: string,
  electionId: string,
) {
  const user = await tx.admin.findFirst({
    where: { id: adminId, institutionId, active: true },
    include: { grants: true },
  });
  requireState(
    !!user && hasPermission(user.grants, "desk:verify", electionId),
    "Selecciona una cuenta activa de mesa o comité con acceso a esta elección.",
  );
}
deskAdmin.get(root, permit("desk:verify"), async (req, res) => {
  const electionId = String(req.params.id),
    user = res.locals.admin;
  const manage = hasPermission(user.grants, "desk:manage", electionId);
  const booths = await db.booth.findMany({
    where: { electionId, ...(manage ? {} : { assignedAdminId: user.id }) },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      assignedAdminId: true,
      active: true,
      tokenHash: true,
    },
  });
  const requests = await db.admission.findMany({
    where: {
      boothId: { in: booths.map((b) => b.id) },
      state: { in: ["WAITING", "APPROVED"] },
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "asc" },
  });
  const students = await db.participation.findMany({
    where: { electionId, studentId: { in: requests.map((r) => r.studentId) } },
    select: {
      studentId: true,
      displayName: true,
      grade: true,
      section: true,
      shift: true,
      state: true,
    },
  });
  const staff = manage
    ? (
        await db.admin.findMany({
          where: { institutionId: user.institutionId, active: true },
          include: { grants: true },
        })
      )
        .filter((u) => hasPermission(u.grants, "desk:verify", electionId))
        .map((u) => ({ id: u.id, name: u.name }))
    : [];
  res.json({
    data: {
      booths: booths.map(({ tokenHash, ...b }) => ({
        ...b,
        paired: !!tokenHash,
      })),
      requests: requests.map((r) => ({
        ...r,
        student: students.find((p) => p.studentId === r.studentId),
      })),
      staff,
    },
  });
});
deskAdmin.post(root + "/booths", permit("desk:manage"), async (req, res) => {
  const input = z
    .object({
      name: z.string().trim().min(2).max(80),
      assignedAdminId: z.uuid(),
    })
    .strict()
    .parse(req.body);
  const result = await db.$transaction(async (tx) => {
    const e = await lockElection(tx, String(req.params.id), true);
    requireState(e.authMode === "DESK" && activeStates.includes(e.state));
    await assignedAdmin(tx, input.assignedAdminId, e.institutionId, e.id);
    const booth = await tx.booth.create({
      data: { ...input, electionId: e.id },
    });
    await audit(tx, res.locals.admin.id, e.id, "BOOTH_CREATED", {
      boothId: booth.id,
      assignedAdminId: booth.assignedAdminId,
    });
    return { id: booth.id };
  });
  res.status(201).json({ data: result });
});
deskAdmin.post(
  root + "/booths/:boothId/pairing",
  permit("desk:manage"),
  async (req, res) => {
    const { reason } = z
      .object({ reason: reasonSchema })
      .strict()
      .parse(req.body);
    const result = await db.$transaction(async (tx) => {
      const e = await lockElection(tx, String(req.params.id), true);
      requireState(e.authMode === "DESK" && activeStates.includes(e.state));
      const b = await tx.booth.findFirst({
        where: {
          id: z.uuid().parse(req.params.boothId),
          electionId: e.id,
          active: true,
        },
      });
      if (!b) throw new AppError(404, "NOT_FOUND", "Cabina no encontrada.");
      const token = newToken();
      await tx.booth.update({
        where: { id: b.id },
        data: {
          pairingHash: hashSecret(token),
          pairingExpiresAt: new Date(Date.now() + 600000),
        },
      });
      await audit(tx, res.locals.admin.id, e.id, "BOOTH_PAIRING_REQUESTED", {
        boothId: b.id,
        reason,
      });
      return {
        url:
          config.WEB_ORIGIN +
          "/cabina/activar#" +
          new URLSearchParams({ id: b.id, token }).toString(),
        expiresInSeconds: 600,
      };
    });
    res.json({ data: result });
  },
);
deskAdmin.patch(
  root + "/booths/:boothId",
  permit("desk:manage"),
  async (req, res) => {
    const { active, assignedAdminId, reason } = z
      .object({
        active: z.boolean(),
        assignedAdminId: z.uuid(),
        reason: reasonSchema,
      })
      .strict()
      .parse(req.body);
    await db.$transaction(async (tx) => {
      const e = await lockElection(tx, String(req.params.id), true);
      requireState(e.authMode === "DESK" && activeStates.includes(e.state));
      const b = await tx.booth.findFirst({
        where: { id: z.uuid().parse(req.params.boothId), electionId: e.id },
      });
      if (!b) throw new AppError(404, "NOT_FOUND", "Cabina no encontrada.");
      await assignedAdmin(tx, assignedAdminId, e.institutionId, e.id);
      const requests = await tx.admission.findMany({
        where: { boothId: b.id },
        select: { id: true },
      });
      await tx.voterSession.updateMany({
        where: { admissionId: { in: requests.map((r) => r.id) } },
        data: { revoked: true },
      });
      await tx.admission.updateMany({
        where: { boothId: b.id, state: { in: ["WAITING", "APPROVED"] } },
        data: { state: "CANCELLED" },
      });
      await tx.booth.update({
        where: { id: b.id },
        data: {
          active,
          assignedAdminId,
          tokenHash: null,
          pairingHash: null,
          pairingExpiresAt: null,
        },
      });
      await audit(tx, res.locals.admin.id, e.id, "BOOTH_UPDATED", {
        boothId: b.id,
        active,
        assignedAdminId,
        reason,
      });
    });
    res.json({ data: { ok: true } });
  },
);
deskAdmin.post(
  root + "/requests/:requestId/cancel",
  permit("desk:verify"),
  async (req, res) => {
    const { reason } = z
      .object({
        reason: reasonSchema,
        identityVerified: z.literal(false).optional(),
      })
      .strict()
      .parse(req.body);
    await db.$transaction(async (tx) => {
      const e = await lockElection(tx, String(req.params.id), true);
      await expire(tx, e.id);
      const r = await tx.admission.findFirst({
        where: { id: z.uuid().parse(req.params.requestId), electionId: e.id },
      });
      requireState(
        !!r && ["WAITING", "APPROVED"].includes(r.state),
        "La solicitud terminó. Actualiza la mesa.",
      );
      const b = await tx.booth.findUniqueOrThrow({ where: { id: r!.boothId } });
      deskScope(res.locals.admin, b);
      requireState(b.active && !!b.tokenHash, "La cabina fue desactivada.");
      await tx.admission.update({
        where: { id: r!.id },
        data: { state: "CANCELLED" },
      });
      await tx.voterSession.updateMany({
        where: { admissionId: r!.id },
        data: { revoked: true },
      });
      await audit(tx, res.locals.admin.id, e.id, "ADMISSION_CANCELLED", {
        admissionId: r!.id,
        boothId: b.id,
        studentId: r!.studentId,
        reason,
      });
    });
    res.json({ data: { ok: true } });
  },
);

boothApi.post(
  "/pair",
  rateLimit({ windowMs: 60000, limit: 30 }),
  async (req, res) => {
    const { id, token } = z
      .object({ id: z.uuid(), token: z.string().min(40).max(100) })
      .strict()
      .parse(req.body);
    const found = await db.booth.findUnique({ where: { id } });
    if (!found)
      throw new AppError(
        401,
        "PAIRING_FAILED",
        "Enlace de activación inválido o vencido.",
      );
    const boothToken = newToken();
    await db.$transaction(async (tx) => {
      const e = await lockElection(tx, found.electionId, true),
        b = await tx.booth.findUniqueOrThrow({ where: { id } });
      requireState(e.authMode === "DESK" && activeStates.includes(e.state));
      if (
        !b.active ||
        !b.pairingExpiresAt ||
        +b.pairingExpiresAt <= Date.now() ||
        b.pairingHash !== hashSecret(token)
      )
        throw new AppError(
          401,
          "PAIRING_FAILED",
          "Enlace de activación inválido o vencido.",
        );
      const requests = await tx.admission.findMany({
        where: { boothId: id },
        select: { id: true },
      });
      await tx.voterSession.updateMany({
        where: { admissionId: { in: requests.map((r) => r.id) } },
        data: { revoked: true },
      });
      await tx.admission.updateMany({
        where: { boothId: id, state: { in: ["WAITING", "APPROVED"] } },
        data: { state: "CANCELLED" },
      });
      await tx.booth.update({
        where: { id },
        data: {
          tokenHash: hashSecret(boothToken),
          pairingHash: null,
          pairingExpiresAt: null,
        },
      });
      await audit(tx, null, e.id, "BOOTH_PAIRED", { boothId: id });
    });
    res.cookie("sivee_booth", boothToken, {
      ...cookieOptions,
      maxAge: 86400000,
    });
    res.clearCookie("sivee_voter", cookieOptions);
    res.json({ data: { ok: true } });
  },
);
boothApi.use(async (req, res, next) => {
  const token = req.cookies.sivee_booth;
  const b =
    token &&
    (await db.booth.findUnique({ where: { tokenHash: hashSecret(token) } }));
  if (!b?.active)
    throw new AppError(
      401,
      "BOOTH_REQUIRED",
      "Este equipo debe ser activado por el comité como cabina de votación.",
    );
  csrf(req, token);
  res.locals.booth = b;
  res.locals.boothCsrf = csrfFor(token);
  next();
});
boothApi.get("/status", async (_req, res) => {
  const b = res.locals.booth;
  const request = await db.admission.findFirst({
    where: { boothId: b.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, state: true, expiresAt: true },
  });
  res.json({
    data: {
      id: b.id,
      name: b.name,
      electionId: b.electionId,
      csrfToken: res.locals.boothCsrf,
      request: request
        ? {
            ...request,
            state:
              ["WAITING", "APPROVED"].includes(request.state) &&
              +request.expiresAt <= Date.now()
                ? "EXPIRED"
                : request.state,
          }
        : null,
    },
  });
});
boothApi.post(
  "/requests",
  rateLimit({
    windowMs: 60000,
    limit: 20,
    keyGenerator: (_req, res) => res.locals.booth.id,
  }),
  async (req, res) => {
    const { dni } = z
      .object({ dni: z.string().regex(/^\d{8}$/) })
      .strict()
      .parse(req.body);
    const b = res.locals.booth;
    const result = await db.$transaction(async (tx) => {
      const e = await lockElection(tx, b.electionId, true);
      const latest = await tx.booth.findUniqueOrThrow({ where: { id: b.id } });
      requireState(
        e.authMode === "DESK" &&
          latest.active &&
          latest.tokenHash === b.tokenHash,
      );
      await expire(tx, e.id);
      requireState(
        !(await tx.admission.findFirst({
          where: { boothId: b.id, state: { in: ["WAITING", "APPROVED"] } },
        })),
        "Hay una sesión vigente en esta cabina. Cancélala antes de continuar.",
      );
      const s = await tx.student.findUnique({
        where: {
          institutionId_dniLookup: {
            institutionId: e.institutionId,
            dniLookup: dniLookup(dni),
          },
        },
      });
      const p =
        s &&
        (await tx.participation.findUnique({
          where: {
            electionId_studentId: { electionId: e.id, studentId: s.id },
          },
        }));
      if (
        !s?.active ||
        p?.state !== "PENDIENTE" ||
        !windowAvailable(
          e,
          e.windows.find((w) => w.shift === p.shift),
        )
      )
        throw new AppError(
          403,
          "DESK_ASSISTANCE",
          "Solicita ayuda a la mesa para verificar tu habilitación y turno.",
        );
      requireState(
        !(await tx.admission.findFirst({
          where: {
            electionId: e.id,
            studentId: s.id,
            state: { in: ["WAITING", "APPROVED"] },
          },
        })),
        "Este estudiante ya tiene una sesión vigente en otra cabina.",
      );
      const r = await tx.admission.create({
        data: {
          electionId: e.id,
          boothId: b.id,
          studentId: s.id,
          state: "APPROVED",
          expiresAt: new Date(Date.now() + 300000),
        },
      });
      await audit(tx, null, e.id, "DNI_ADMISSION_CREATED", {
        admissionId: r.id,
        boothId: b.id,
        studentId: s.id,
      });
      return { id: r.id, state: r.state };
    });
    res.status(201).json({ data: result });
  },
);
boothApi.post("/claim", async (req, res) => {
  const { requestId } = z
      .object({ requestId: z.uuid() })
      .strict()
      .parse(req.body),
    b = res.locals.booth;
  const data = await db.$transaction(async (tx) => {
    const e = await lockElection(tx, b.electionId, true);
    const latest = await tx.booth.findUniqueOrThrow({ where: { id: b.id } });
    requireState(latest.active && latest.tokenHash === b.tokenHash);
    const r = await tx.admission.findFirst({
      where: {
        id: requestId,
        electionId: e.id,
        boothId: b.id,
        state: "APPROVED",
        expiresAt: { gt: new Date() },
      },
    });
    requireState(
      !!r,
      "La sesión terminó o no está disponible. Vuelve a ingresar tu DNI.",
    );
    const p = await tx.participation.findUniqueOrThrow({
      where: {
        electionId_studentId: { electionId: e.id, studentId: r!.studentId },
      },
      include: { student: true },
    });
    requireState(
      p.state === "PENDIENTE" &&
        p.student.active &&
        windowAvailable(
          e,
          e.windows.find((w) => w.shift === p.shift),
        ),
    );
    await tx.voterSession.updateMany({
      where: { admissionId: r!.id },
      data: { revoked: true },
    });
    const session = await issueSession(
      res,
      "voter",
      { electionId: e.id, studentId: p.studentId, admissionId: r!.id },
      tx,
    );
    return {
      ...session,
      expiresInSeconds: Math.max(
        1,
        Math.floor((+r!.expiresAt - Date.now()) / 1000),
      ),
      student: {
        displayName: p.displayName,
        grade: p.grade,
        section: p.section,
        shift: p.shift,
      },
    };
  });
  res.json({ data });
});
boothApi.post("/cancel", async (req, res) => {
  const { requestId } = z
      .object({ requestId: z.uuid() })
      .strict()
      .parse(req.body),
    b = res.locals.booth;
  await db.$transaction(async (tx) => {
    await lockElection(tx, b.electionId, true);
    const latest = await tx.booth.findUniqueOrThrow({ where: { id: b.id } });
    requireState(latest.active && latest.tokenHash === b.tokenHash);
    const r = await tx.admission.findFirst({
      where: { id: requestId, boothId: b.id },
    });
    requireState(!!r, "Solicitud no encontrada.");
    await tx.admission.updateMany({
      where: { id: requestId, state: { in: ["WAITING", "APPROVED"] } },
      data: { state: "CANCELLED" },
    });
    await tx.voterSession.updateMany({
      where: { admissionId: requestId },
      data: { revoked: true },
    });
  });
  res.json({ data: { ok: true } });
});
