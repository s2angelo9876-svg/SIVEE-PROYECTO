import "dotenv/config";
import { z } from "zod";
const schema = z.object({
  SIVEE_ENV: z.enum(["demo", "test", "production"]).default("demo"),
  DATABASE_URL: z.url(),
  DNI_LOOKUP_KEY: z.string().min(32),
  SESSION_PEPPER: z.string().min(32),
  CSRF_KEY: z.string().min(32),
  PORT: z.coerce.number().default(5000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
  WEB_ORIGIN: z.url().default("http://localhost:5173"),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  ALLOW_DEMO_RESET: z.enum(["true", "false"]).default("false"),
});
export const config = schema.parse(process.env);
const database = new URL(config.DATABASE_URL).pathname;
if (
  config.SIVEE_ENV !== "production" &&
  !/^\/sivee_(demo|test)(_[a-z0-9]+)?$/.test(database)
)
  throw new Error(
    "DEMO y TEST solo pueden usar una base sivee_demo o sivee_test.",
  );
if (
  config.SIVEE_ENV === "production" &&
  (new URL(config.DATABASE_URL).username !== "sivee_app" ||
    config.COOKIE_SECURE !== "true" ||
    !config.WEB_ORIGIN.startsWith("https:") ||
    config.ALLOW_DEMO_RESET === "true" ||
    /demo|test/.test(database))
)
  throw new Error("Configuración productiva insegura.");
