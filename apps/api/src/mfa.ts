import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { config } from "./config.js";
import { db } from "./db.js";
import {
  AppError,
  verifyPassword,
  passwordHash,
  safeEqual,
} from "./security.js";
import { permit } from "./auth.js";
import { audit } from "./services.js";
import { rolePermissions } from "../../../packages/shared/domain.js";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function encode(b: Buffer) {
  let bits = "";
  for (const n of b) bits += n.toString(2).padStart(8, "0");
  return bits
    .match(/.{1,5}/g)!
    .map((s) => alphabet[parseInt(s.padEnd(5, "0"), 2)])
    .join("");
}
function decode(s: string) {
  const bits = [...s]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  return Buffer.from((bits.match(/.{8}/g) || []).map((s) => parseInt(s, 2)));
}
const key = () =>
  crypto.createHash("sha256").update(config.SESSION_PEPPER).digest();
function encrypt(value: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((x) => x.toString("base64")).join(".");
}
function decrypt(value: string) {
  const [iv, tag, data] = value.split(".").map((s) => Buffer.from(s, "base64"));
  const c = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  c.setAuthTag(tag);
  return Buffer.concat([c.update(data), c.final()]).toString("utf8");
}
export function totp(secret: string, counter: number) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", decode(secret)).update(b).digest();
  const o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, "0");
}
export function verifyTotp(encrypted: string, code: string) {
  if (!/^\d{6}$/.test(code)) return false;
  const t = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some((d) =>
    safeEqual(totp(decrypt(encrypted), t + d), code),
  );
}
export const accountRoutes = Router();
accountRoutes.post("/mfa/setup", async (req, res) => {
  const { password } = z
    .object({ password: z.string().max(200) })
    .strict()
    .parse(req.body);
  const u = res.locals.admin;
  if (u.mfaEnabled || !(await verifyPassword(u.passwordHash, password)))
    throw new AppError(
      403,
      "FORBIDDEN",
      "No se puede iniciar la configuración.",
    );
  const secret = encode(crypto.randomBytes(20));
  await db.admin.update({
    where: { id: u.id },
    data: { mfaSecret: encrypt(secret) },
  });
  res.json({
    data: {
      secret,
      uri: `otpauth://totp/SIVEE:${encodeURIComponent(u.email)}?secret=${secret}&issuer=SIVEE`,
    },
  });
});
accountRoutes.post("/mfa/confirm", async (req, res) => {
  const { code } = z
    .object({ code: z.string().regex(/^\d{6}$/) })
    .strict()
    .parse(req.body);
  const u = await db.admin.findUniqueOrThrow({
    where: { id: res.locals.admin.id },
  });
  if (!u.mfaSecret || !verifyTotp(u.mfaSecret, code))
    throw new AppError(400, "MFA_INVALID", "Código no válido.");
  await db.admin.update({ where: { id: u.id }, data: { mfaEnabled: true } });
  await audit(db, u.id, null, "MFA_ENABLED");
  res.json({ data: { ok: true } });
});
accountRoutes.get("/accounts", permit("accounts:manage"), async (_req, res) =>
  res.json({
    data: await db.admin.findMany({
      where: { institutionId: res.locals.admin.institutionId },
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
        mfaEnabled: true,
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
