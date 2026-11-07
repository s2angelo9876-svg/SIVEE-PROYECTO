import crypto from "node:crypto";
import { config } from "./config.js";
// Domain separation prevents using the session HMAC key directly as an AES key.
const key = crypto
  .createHash("sha256")
  .update("sivee-roster-v1:")
  .update(config.SESSION_PEPPER)
  .digest();
export function encryptDocument(value: string) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((b) => b.toString("base64url"))
    .join(".");
}
export function decryptDocument(value: string) {
  const [iv, tag, data] = value
    .split(".")
    .map((s) => Buffer.from(s, "base64url"));
  const cipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
