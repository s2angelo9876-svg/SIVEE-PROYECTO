import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "./db.js";
import { config } from "./config.js";
import {
  AppError,
  hashSecret,
  csrfFor,
  safeEqual,
  newToken,
} from "./security.js";
import { hasPermission } from "../../../packages/shared/domain.js";
import { audit, type Tx } from "./services.js";
export const cookieOptions = {
  httpOnly: true,
  secure: config.COOKIE_SECURE === "true",
  sameSite: "strict" as const,
  path: "/api/v1",
};
export async function issueSession(
  res: Response,
  kind: "voter" | "admin",
  fields:
    | { studentId: string; electionId: string; admissionId?: string }
    | { adminId: string; purpose?: string },
  tx: Tx = db,
) {
  const token = newToken();
  const ttl = kind === "voter" ? 300 : 1800;
  const data = {
    ...fields,
    tokenHash: hashSecret(token),
    expiresAt: new Date(Date.now() + ttl * 1000),
  };
  if (kind === "voter") await tx.voterSession.create({ data: data as any });
  else await tx.adminSession.create({ data: data as any });
  res.cookie(`sivee_${kind}`, token, { ...cookieOptions, maxAge: ttl * 1000 });
  return { csrfToken: csrfFor(token), expiresInSeconds: ttl };
}
export const originGuard = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.get("origin") !== config.WEB_ORIGIN
  )
    return next(
      new AppError(
        403,
        "ORIGIN_REJECTED",
        "Origen de solicitud no autorizado.",
      ),
    );
  next();
};
export function csrf(req: Request, token: string) {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    !safeEqual(req.get("x-csrf-token") || "", csrfFor(token))
  )
    throw new AppError(
      403,
      "CSRF_REJECTED",
      "La solicitud no se pudo verificar. Actualiza la sesión.",
    );
}
export async function voterAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const token = req.cookies.sivee_voter;
  if (!token)
    throw new AppError(401, "UNAUTHENTICATED", "Identifícate para continuar.");
  const session = await db.voterSession.findUnique({
    where: { tokenHash: hashSecret(token) },
    include: { student: true, election: true },
  });
  if (
    !session ||
    session.revoked ||
    session.admissionId ||
    +session.expiresAt < Date.now()
  )
    throw new AppError(
      401,
      "UNAUTHENTICATED",
      "Tu sesión ha vencido. Vuelve a identificarte.",
    );
  csrf(req, token);
  res.locals.voter = session;
  res.locals.csrfToken = csrfFor(token);
  if (!session.consumed && session.election.authMode === "CODE")
    await db.voterSession.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() + 300000) },
    });
  next();
}
export async function adminAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const token = req.cookies.sivee_admin;
  if (!token)
    throw new AppError(401, "UNAUTHENTICATED", "Inicia sesión para continuar.");
  const session = await db.adminSession.findUnique({
    where: { tokenHash: hashSecret(token) },
    include: { admin: { include: { grants: true } } },
  });
  if (
    !session ||
    session.revoked ||
    +session.expiresAt < Date.now() ||
    !session.admin.active
  )
    throw new AppError(401, "UNAUTHENTICATED", "Tu sesión ha vencido.");
  csrf(req, token);
  // Legacy MFA_SETUP sessions already verified the password; normal permissions apply.
  res.locals.admin = session.admin;
  res.locals.adminSession = session;
  res.locals.csrfToken = csrfFor(token);
  await db.adminSession.update({
    where: { id: session.id },
    data: { expiresAt: new Date(Date.now() + 1800000) },
  });
  res.cookie("sivee_admin", token, { ...cookieOptions, maxAge: 1800000 });
  next();
}
export function permit(permission: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = res.locals.admin;
    const id = String(req.params.id || "");
    if (!hasPermission(user.grants, permission, id || undefined)) {
      await audit(db, user.id, null, "ACCESS_DENIED", { permission });
      throw new AppError(
        403,
        "FORBIDDEN",
        "No tienes permiso para esta acción.",
      );
    }
    if (id) {
      z.uuid().parse(id);
      const e = await db.election.findFirst({
        where: { id, institutionId: user.institutionId },
      });
      if (!e) throw new AppError(404, "NOT_FOUND", "Elección no encontrada.");
      res.locals.election = e;
    }
    next();
  };
}
