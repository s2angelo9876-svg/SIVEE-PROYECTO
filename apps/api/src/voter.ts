import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { db } from "./db.js";
import { config } from "./config.js";
import { voterLoginSchema, uuid } from "../../../packages/shared/domain.js";
import {
  AppError,
  dniLookup,
  passwordHash,
  verifyPassword,
} from "./security.js";
import { issueSession, voterAuth, cookieOptions } from "./auth.js";
import { castVote, windowAvailable, lockElection } from "./services.js";
export const voter = Router();
const dummyHash = await passwordHash("not-a-valid-credential");
const authLimit = rateLimit({
  windowMs: 60000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Demasiados intentos. Espera un minuto.",
        requestId: res.locals.requestId,
      },
    }),
});
voter.post("/sessions", authLimit, async (req, res) => {
  const parsed = voterLoginSchema.safeParse(req.body);
  if (!parsed.success)
    throw new AppError(
      401,
      "AUTH_FAILED",
      "No pudimos verificar tus datos. Solicita ayuda a la mesa.",
    );
  const { electionId, dni, accessCode } = parsed.data;
  const e = await db.election.findUnique({
    where: { id: electionId },
    include: { windows: true },
  });
  const student = e
    ? await db.student.findUnique({
        where: {
          institutionId_dniLookup: {
            institutionId: e.institutionId,
            dniLookup: dniLookup(dni),
          },
        },
      })
    : null;
  const c = student
    ? await db.credential.findUnique({
        where: { electionId_studentId: { electionId, studentId: student.id } },
      })
    : null;
  const verified = await verifyPassword(c?.codeHash || dummyHash, accessCode);
  const invalid =
    !e ||
    !student?.active ||
    !c?.active ||
    +c.expiresAt < Date.now() ||
    (c.lockedUntil && +c.lockedUntil > Date.now()) ||
    !verified;
  if (invalid) {
    if (c && !verified)
      await db.$executeRaw`UPDATE credentials SET attempts=attempts+1, "lockedUntil"=CASE WHEN attempts+1>=5 THEN now()+interval '5 minutes' ELSE "lockedUntil" END WHERE id=${c.id}::uuid`;
    throw new AppError(
      401,
      "AUTH_FAILED",
      "No pudimos verificar tus datos. Solicita ayuda a la mesa.",
    );
  }
  const p = await db.participation.findUnique({
    where: { electionId_studentId: { electionId, studentId: student.id } },
  });
  if (!p || p.state === "ANULADA_POR_COMITE")
    throw new AppError(
      401,
      "AUTH_FAILED",
      "No pudimos verificar tus datos. Solicita ayuda a la mesa.",
    );
  if (
    p.state !== "VOTO_EMITIDO" &&
    !windowAvailable(
      e,
      e.windows.find((w) => w.shift === p.shift),
    )
  )
    throw new AppError(
      409,
      "VOTING_WINDOW_CLOSED",
      "Tu turno aún no está abierto o se encuentra en pausa.",
    );
  const session = await db.$transaction(async (tx) => {
    const latestElection = await lockElection(tx, electionId);
    const latest = await tx.credential.findUnique({ where: { id: c.id } });
    if (
      !latest ||
      latest.codeHash !== c.codeHash ||
      !latest.active ||
      +latest.expiresAt < Date.now() ||
      (latest.lockedUntil && +latest.lockedUntil > Date.now())
    )
      throw new AppError(
        401,
        "AUTH_FAILED",
        "No pudimos verificar tus datos. Solicita ayuda a la mesa.",
      );
    const latestParticipation = await tx.participation.findUniqueOrThrow({
      where: { id: p.id },
    });
    if (latestParticipation.state === "ANULADA_POR_COMITE")
      throw new AppError(
        401,
        "AUTH_FAILED",
        "No pudimos verificar tus datos. Solicita ayuda a la mesa.",
      );
    if (
      latestParticipation.state !== "VOTO_EMITIDO" &&
      !windowAvailable(
        latestElection,
        latestElection.windows.find(
          (w) => w.shift === latestParticipation.shift,
        ),
      )
    )
      throw new AppError(
        409,
        "VOTING_WINDOW_CLOSED",
        "Tu turno no está abierto.",
      );
    await tx.credential.update({
      where: { id: c.id },
      data: { attempts: 0, lockedUntil: null },
    });
    return issueSession(
      res,
      "voter",
      { studentId: student.id, electionId },
      tx,
    );
  });
  res.json({
    data: {
      ...session,
      electionId,
      alreadyRecorded: p.state === "VOTO_EMITIDO",
      student: {
        displayName: p.displayName,
        grade: p.grade,
        section: p.section,
        shift: p.shift,
      },
    },
  });
});
voter.use(voterAuth);
voter.get("/me", async (_req, res) => {
  const s = res.locals.voter;
  const p = await db.participation.findUniqueOrThrow({
    where: {
      electionId_studentId: {
        electionId: s.electionId,
        studentId: s.studentId,
      },
    },
  });
  res.json({
    data: {
      electionId: s.electionId,
      csrfToken: res.locals.csrfToken,
      student: {
        displayName: p.displayName,
        grade: p.grade,
        section: p.section,
        shift: p.shift,
      },
    },
  });
});
voter.get("/status", async (_req, res) => {
  const s = res.locals.voter;
  const p = await db.participation.findUnique({
    where: {
      electionId_studentId: {
        electionId: s.electionId,
        studentId: s.studentId,
      },
    },
  });
  res.json({
    data: { status: p?.state === "VOTO_EMITIDO" ? "RECORDED" : "PENDING" },
  });
});
voter.get("/ballot", async (_req, res) => {
  const s = res.locals.voter;
  if (s.consumed)
    throw new AppError(
      409,
      "ALREADY_RECORDED",
      "Tu participación ya está registrada.",
    );
  const e = await db.election.findUniqueOrThrow({
    where: { id: s.electionId },
    include: {
      windows: true,
      lists: { where: { active: true }, orderBy: { number: "asc" } },
    },
  });
  const participation = await db.participation.findUniqueOrThrow({
    where: {
      electionId_studentId: {
        electionId: s.electionId,
        studentId: s.studentId,
      },
    },
  });
  if (
    !windowAvailable(
      e,
      e.windows.find((w) => w.shift === participation.shift),
    )
  )
    throw new AppError(
      409,
      "VOTING_WINDOW_CLOSED",
      "La votación no está habilitada para tu turno.",
    );
  res.json({
    data: {
      electionId: e.id,
      electionName: e.name,
      ballotVersion: e.version,
      lists: e.lists,
      blankAllowed: e.blankAllowed,
      nullAllowed: e.nullAllowed,
    },
  });
});
voter.post("/votes", async (req, res) => {
  if (!uuid.safeParse(req.get("idempotency-key")).success)
    throw new AppError(
      400,
      "INVALID_PAYLOAD",
      "Falta el identificador del intento.",
    );
  const result = await castVote(res.locals.voter.id, req.body);
  res.status(result.status === "RECORDED" ? 201 : 200).json({
    data: {
      ...result,
      message: "Tu participación fue registrada correctamente.",
    },
  });
});
voter.post("/logout", async (_req, res) => {
  await db.voterSession.update({
    where: { id: res.locals.voter.id },
    data: { revoked: true },
  });
  res.clearCookie("sivee_voter", cookieOptions);
  res.json({ data: { ok: true } });
});
export const demoMode = config.SIVEE_ENV === "demo";
