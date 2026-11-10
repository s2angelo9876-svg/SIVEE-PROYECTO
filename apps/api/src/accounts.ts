import { Router } from "express";
import { z } from "zod";
import { db } from "./db.js";
import { AppError, passwordHash } from "./security.js";
import { permit } from "./auth.js";
import { audit } from "./services.js";
import { rolePermissions } from "../../../packages/shared/domain.js";
export const accountRoutes = Router();
accountRoutes.get("/accounts", permit("accounts:manage"), async (_req, res) =>
  res.json({
    data: await db.admin.findMany({
      where: { institutionId: res.locals.admin.institutionId },
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
        grants: true,
      },
    }),
  }),
);
accountRoutes.post("/accounts", permit("accounts:manage"), async (req, res) => {
  const input = z
    .object({
      name: z.string().min(3).max(100),
      email: z.email(),
      password: z.string().min(12).max(200),
      role: z.enum([
        "COMITE",
        "OPERADOR",
        "OBSERVADOR",
        "MESA",
        "ADMIN_TECNICO",
      ]),
      electionScope: z.union([z.literal("*"), z.uuid()]),
    })
    .strict()
    .parse(req.body);
  if (
    input.electionScope !== "*" &&
    !(await db.election.findFirst({
      where: {
        id: input.electionScope,
        institutionId: res.locals.admin.institutionId,
      },
    }))
  )
    throw new AppError(404, "NOT_FOUND", "Elección no encontrada.");
  const u = await db.admin.create({
    data: {
      name: input.name,
      email: input.email.toLowerCase(),
      passwordHash: await passwordHash(input.password),
      institutionId: res.locals.admin.institutionId,
      grants: {
        create: {
          role: input.role,
          electionScope: input.electionScope,
          permissions: rolePermissions[input.role],
        },
      },
    },
    select: { id: true, name: true, email: true },
  });
  await audit(db, res.locals.admin.id, null, "ACCOUNT_CREATED", {
    role: input.role,
  });
  res.json({ data: u });
});
accountRoutes.patch(
  "/accounts/:accountId",
  permit("accounts:manage"),
  async (req, res) => {
    const id = z.uuid().parse(req.params.accountId);
    const { active } = z
      .object({ active: z.boolean() })
      .strict()
      .parse(req.body);
    if (id === res.locals.admin.id)
      throw new AppError(
        409,
        "SELF_DISABLE",
        "No puedes desactivar tu propia cuenta.",
      );
    const r = await db.admin.updateMany({
      where: { id, institutionId: res.locals.admin.institutionId },
      data: { active },
    });
    if (!r.count) throw new AppError(404, "NOT_FOUND", "Cuenta no encontrada.");
    await db.adminSession.updateMany({
      where: { adminId: id },
      data: { revoked: true },
    });
    await audit(db, res.locals.admin.id, null, "ACCOUNT_STATE_CHANGED", {
      active,
    });
    res.json({ data: { ok: true } });
  },
);
