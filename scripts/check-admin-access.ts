import "dotenv/config";
import { z } from "zod";
import { config } from "../apps/api/src/config.js";
import { db } from "../apps/api/src/db.js";
import { requireState, verifyPassword } from "../apps/api/src/security.js";

try {
  requireState(
    config.SIVEE_ENV === "production",
    "Se requiere entorno oficial.",
  );
  const input = z
    .object({
      INITIAL_ADMIN_EMAIL: z.email(),
      INITIAL_ADMIN_PASSWORD: z.string().min(1).max(200),
    })
    .parse(process.env);
  const user = await db.admin.findUnique({
    where: { email: input.INITIAL_ADMIN_EMAIL.toLowerCase() },
    select: { active: true, passwordHash: true, mfaEnabled: true },
  });
  const [adminCount, institutionCount] = await Promise.all([
    db.admin.count(),
    db.institution.count(),
  ]);
  console.log(
    JSON.stringify({
      databaseReachable: true,
      adminCount,
      institutionCount,
      accountFound: !!user,
      accountActive: user?.active ?? null,
      passwordMatches: user
        ? await verifyPassword(user.passwordHash, input.INITIAL_ADMIN_PASSWORD)
        : null,
      mfaEnabled: user?.mfaEnabled ?? null,
      readOnly: true,
    }),
  );
} catch {
  console.error(
    "No se pudo comprobar el acceso. Revisa la conexión, el entorno oficial e INITIAL_ADMIN_EMAIL/PASSWORD. No se modificaron credenciales.",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
