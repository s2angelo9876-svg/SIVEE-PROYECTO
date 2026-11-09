import crypto from "node:crypto";
import argon2 from "argon2";
import { config } from "./config.js";
export const hashSecret = (value: string) =>
  crypto
    .createHmac("sha256", config.SESSION_PEPPER)
    .update(value)
    .digest("hex");
export const dniLookup = (value: string) =>
  crypto
    .createHmac("sha256", config.DNI_LOOKUP_KEY)
    .update(value)
    .digest("hex");
export const newToken = () => crypto.randomBytes(32).toString("base64url");
export const foreignLookup = (studentCode: string) =>
  dniLookup("FOREIGN:" + studentCode.trim().toUpperCase());
export const csrfFor = (token: string) =>
  crypto.createHmac("sha256", config.CSRF_KEY).update(token).digest("hex");
export const safeEqual = (a: string, b: string) =>
  a.length === b.length &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const passwordHash = (s: string) =>
  argon2.hash(s, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
export const verifyPassword = (hash: string, value: string) =>
  argon2.verify(hash, value).catch(() => false);
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function requireState(
  allowed: boolean,
  message = "Esta operación no está disponible en el estado actual.",
) {
  if (!allowed) throw new AppError(409, "INVALID_ELECTION_STATE", message);
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export const digest = (v: unknown) =>
  crypto.createHash("sha256").update(canonical(v)).digest("hex");
