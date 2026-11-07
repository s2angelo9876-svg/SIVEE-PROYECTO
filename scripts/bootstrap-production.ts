import "dotenv/config";
import { z } from "zod";
import { config } from "../apps/api/src/config.js";
import { db } from "../apps/api/src/db.js";
import { passwordHash, requireState } from "../apps/api/src/security.js";
import { audit } from "../apps/api/src/services.js";
import { rolePermissions } from "../packages/shared/domain.js";
try {
  requireState(
    config.SIVEE_ENV === "production",
    "Configura SIVEE_ENV=production para inicializar una instalación oficial.",
  );
  const input = z
    .object({
      INSTITUTION_CODE: z.string().trim().min(2).max(50),
      INSTITUTION_NAME: z.string().trim().min(5).max(150),
      INITIAL_ADMIN_EMAIL: z.email(),
      INITIAL_ADMIN_NAME: z.string().trim().min(3).max(100),
      INITIAL_ADMIN_PASSWORD: z.string().min(16).max(200),
    })
    .parse(process.env);
  const hash = await passwordHash(input.INITIAL_ADMIN_PASSWORD);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(762643212)`;
    requireState(
      (await tx.institution.count()) === 0 && (await tx.admin.count()) === 0,
      "La instalación ya contiene una institución o cuentas. No se sobrescribió nada.",
    );
    const institution = await tx.institution.create({
      data: {
        code: input.INSTITUTION_CODE,
        name: input.INSTITUTION_NAME,
        timezone: "America/Lima",
      },
    });
    const admin = await tx.admin.create({
      data: {
        institutionId: institution.id,
        email: input.INITIAL_ADMIN_EMAIL.toLowerCase(),
        name: input.INITIAL_ADMIN_NAME,
        passwordHash: hash,
        grants: {
          create: ["ADMIN_TECNICO", "COMITE"].map((role) => ({
            role,
            permissions: rolePermissions[role],
            electionScope: "*",
          })),
        },
      },
    });
    await audit(tx, admin.id, null, "INSTALLATION_INITIALIZED");
  });
  console.log(
    "Instalación creada sin estudiantes ni elecciones de ejemplo. Activa MFA en el primer acceso. Retira INITIAL_ADMIN_PASSWORD del entorno de operaciones.",
  );
} catch (error) {
  console.error(
    error instanceof z.ZodError
      ? "Revisa INSTITUTION_CODE, INSTITUTION_NAME y INITIAL_ADMIN_EMAIL/NAME/PASSWORD (contraseña de al menos 16 caracteres)."
      : (error as any)?.code === "INVALID_STATE"
        ? (error as Error).message
        : "No se pudo inicializar. Comprueba configuración, migraciones y acceso a PostgreSQL.",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
