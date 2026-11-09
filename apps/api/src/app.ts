import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "./db.js";
import { voter } from "./voter.js";
import { admin } from "./admin.js";
import { accountRoutes } from "./mfa.js";
import { config } from "./config.js";
import { originGuard } from "./auth.js";
import { AppError } from "./security.js";
export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", config.TRUST_PROXY_HOPS || false);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.COOKIE_SECURE === "true" ? [] : null,
      },
    },
    strictTransportSecurity:
      config.COOKIE_SECURE === "true" ? undefined : false,
  }),
);
app.use((req, res, next) => {
  res.locals.requestId = crypto.randomUUID();
  res.set("X-Request-ID", res.locals.requestId);
  if (req.path.startsWith("/api"))
    res.set("Cache-Control", "no-store, private");
  next();
});
app.use(cookieParser());
app.use(originGuard);
app.use("/api/v1/admin/elections/:id/roster", express.json({ limit: "8mb" }));
app.use("/api/v1/admin/institution/crest", express.json({ limit: "1mb" }));
app.use("/api/v1/admin/elections/:id/lists", express.json({ limit: "512kb" }));
app.use(express.json({ limit: "32kb" }));
app.get("/api/v1/health/live", (_req, res) =>
  res.json({ data: { status: "ok", service: "SIVEE" } }),
);
app.get("/api/v1/site", async (_req, res) => {
  const institution = await db.institution.findFirst({
    select: { id: true, name: true },
  });
  const crest =
    institution &&
    (await db.institutionBranding.findUnique({
      where: { institutionId: institution.id },
      select: { mime: true },
    }));
  res.json({
    data: {
      mode: config.SIVEE_ENV === "production" ? "OFICIAL" : "DEMO",
      institution: institution?.name || "Comunidad educativa",
      crestUrl: crest ? "/api/v1/branding/crest" : null,
    },
  });
});
app.get("/api/v1/branding/crest", async (_req, res) => {
  const institution = await db.institution.findFirst({ select: { id: true } });
  const crest =
    institution &&
    (await db.institutionBranding.findUnique({
      where: { institutionId: institution.id },
    }));
  if (!crest) throw new AppError(404, "NOT_FOUND", "Escudo no configurado.");
  res.type(crest.mime).send(Buffer.from(crest.image));
});
app.get("/api/v1/health/ready", async (_req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    await db.$queryRaw`SELECT "isForeign" FROM school_drafts LIMIT 0`;
    res.json({
      data: { status: "ready", database: "connected", mode: config.SIVEE_ENV },
    });
  } catch {
    res.status(503).json({
      error: {
        code: "DEPENDENCY_UNAVAILABLE",
        message: "Servicio temporalmente no disponible.",
        requestId: res.locals.requestId,
      },
    });
  }
});
app.get("/api/v1/elections/active/public", async (_req, res) => {
  const e = await db.election.findFirst({
    where: {
      state: { not: "ANULADA" },
      mode: config.SIVEE_ENV === "production" ? "OFICIAL" : "DEMO",
    },
    orderBy: { createdAt: "desc" },
    include: { institution: true, windows: true },
  });
  res.json({
    data: e
      ? {
          id: e.id,
          name: e.name,
          year: e.year,
          scope: e.scope,
          state: e.state,
          mode: e.mode,
          authMode: e.authMode,
          institution: e.institution.name,
          contact: e.contact,
          windows: e.windows.map((w) => ({
            shift: w.shift,
            state: w.state,
            startsAt: w.startsAt,
            endsAt: w.endsAt,
          })),
        }
      : null,
  });
});
app.use("/api/v1/voter", voter);
admin.use(accountRoutes);
app.use("/api/v1/admin", admin);
app.use("/api", (_req, res) =>
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Ruta no encontrada.",
      requestId: res.locals.requestId,
    },
  }),
);
const frontend = path.resolve("apps/web/dist");
if (fs.existsSync(frontend)) {
  app.use(express.static(frontend, { index: false }));
  app.get("/{*path}", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.sendFile(path.join(frontend, "index.html"));
  });
}
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    let status = 500,
      code = "INTERNAL_ERROR",
      message = "Ocurrió un error. Reintenta o informa a la mesa.";
    if (error instanceof AppError) {
      ({ status, code, message } = error);
    } else if (error instanceof ZodError) {
      status = 400;
      code = "INVALID_PAYLOAD";
      message = "Revisa los campos y el formato de la solicitud.";
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        status = 409;
        code = "DUPLICATE";
        message = "El registro ya existe.";
      } else if (error.code === "P2025") {
        status = 404;
        code = "NOT_FOUND";
        message = "Registro no encontrado.";
      }
    } else if ((error as any)?.type === "entity.too.large") {
      status = 413;
      code = "PAYLOAD_TOO_LARGE";
      message = "El archivo supera el tamaño permitido.";
    }
    if (status === 500)
      console.error(
        JSON.stringify({
          event: "request_failed",
          requestId: res.locals.requestId,
          errorType: error instanceof Error ? error.name : "unknown",
        }),
      );
    res
      .status(status)
      .json({ error: { code, message, requestId: res.locals.requestId } });
  },
);
